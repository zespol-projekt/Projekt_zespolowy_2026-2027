


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."compare_basket"("p_base_product_ids" integer[], "p_allow_multibuy" boolean DEFAULT true, "p_normalize_weight" boolean DEFAULT false) RETURNS TABLE("store_id" integer, "store_name" character varying, "matched_items_count" integer, "total_requested_count" integer, "total_basket_price" numeric, "total_regular_price" numeric, "total_savings" numeric)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN QUERY
    WITH cat_std_weights AS (
        -- Wyliczamy typową (medianową) gramaturę dla każdej kategorii bazowej (np. 200g dla masła)
        SELECT
            v.base_product_id,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.quantity_value) AS median_qty
        FROM public.v_store_offers_full v
        WHERE v.base_product_id = ANY(p_base_product_ids)
          AND v.quantity_value > 0
        GROUP BY v.base_product_id
    ),
    scored_offers AS (
        SELECT
            v.store_id,
            v.base_product_id,
            CASE WHEN p_allow_multibuy THEN v.effective_price ELSE v.single_item_price END AS chosen_price,
            v.regular_price,
            -- Jeśli p_normalize_weight = TRUE, przeliczamy cenę proporcjonalnie do medianowej wagi kategorii
            CASE
                WHEN p_normalize_weight AND v.quantity_value > 0 AND cw.median_qty > 0 THEN
                    ROUND(((CASE WHEN p_allow_multibuy THEN v.effective_price ELSE v.single_item_price END) / v.quantity_value) * cw.median_qty, 2)
                ELSE
                    (CASE WHEN p_allow_multibuy THEN v.effective_price ELSE v.single_item_price END)
            END AS comparable_price,
            CASE
                WHEN p_normalize_weight AND v.quantity_value > 0 AND cw.median_qty > 0 THEN
                    ROUND((v.regular_price / v.quantity_value) * cw.median_qty, 2)
                ELSE
                    v.regular_price
            END AS comparable_reg_price
        FROM public.v_store_offers_full v
        LEFT JOIN cat_std_weights cw ON cw.base_product_id = v.base_product_id
        WHERE v.base_product_id = ANY(p_base_product_ids)
          AND (CASE WHEN p_allow_multibuy THEN v.effective_price ELSE v.single_item_price END) IS NOT NULL
    ),
    cheapest_per_store_cat AS (
        SELECT DISTINCT ON (so.store_id, so.base_product_id)
            so.store_id,
            so.base_product_id,
            so.comparable_price,
            so.comparable_reg_price
        FROM scored_offers so
        ORDER BY so.store_id, so.base_product_id, so.comparable_price ASC
    )
    SELECT
        s.id AS store_id,
        s.name AS store_name,
        COUNT(c.base_product_id)::INT AS matched_items_count,
        COALESCE(ARRAY_LENGTH(p_base_product_ids, 1), 0)::INT AS total_requested_count,
        COALESCE(SUM(c.comparable_price), 0.00)::NUMERIC(10, 2) AS total_basket_price,
        COALESCE(SUM(c.comparable_reg_price), 0.00)::NUMERIC(10, 2) AS total_regular_price,
        COALESCE(SUM(c.comparable_reg_price - c.comparable_price), 0.00)::NUMERIC(10, 2) AS total_savings
    FROM public.stores s
    LEFT JOIN cheapest_per_store_cat c ON c.store_id = s.id
    WHERE s.is_active = TRUE
    GROUP BY s.id, s.name
    ORDER BY matched_items_count DESC, total_basket_price ASC;
END;
$$;


ALTER FUNCTION "public"."compare_basket"("p_base_product_ids" integer[], "p_allow_multibuy" boolean, "p_normalize_weight" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_price_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF (TG_OP = 'INSERT' AND (NEW.regular_price IS NOT NULL OR NEW.promo_price IS NOT NULL)) THEN
        INSERT INTO public.price_history (store_offer_id, regular_price, promo_price, price_source)
        VALUES (NEW.id, NEW.regular_price, NEW.promo_price, NEW.price_source);
    ELSIF (TG_OP = 'UPDATE' AND (
        NEW.regular_price IS DISTINCT FROM OLD.regular_price OR
        NEW.promo_price IS DISTINCT FROM OLD.promo_price
    )) THEN
        INSERT INTO public.price_history (store_offer_id, regular_price, promo_price, price_source)
        VALUES (NEW.id, NEW.regular_price, NEW.promo_price, NEW.price_source);
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_log_price_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."norm_text"("t" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT trim(regexp_replace(lower(public.unaccent(coalesce(t, ''))), '[^a-z0-9%]+', ' ', 'g'));
$$;


ALTER FUNCTION "public"."norm_text"("t" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_offers"("search_query" "text" DEFAULT ''::"text", "result_limit" integer DEFAULT 40) RETURNS TABLE("id" integer, "name" "text", "regular_price" numeric, "promo_price" numeric, "normalized_weight" "text", "image_url" "text", "kcal_100g" numeric, "store_name" "text", "base_product_name" "text", "relevance_score" numeric)
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
    q TEXT := public.norm_text(search_query);
BEGIN
    -- Jeśli wyszukiwarka jest pusta, zwracamy domyślne produkty (np. aktualne promocje)
    IF q = '' THEN
        RETURN QUERY
        SELECT 
            so.id,
            so.name,
            so.regular_price,
            so.promo_price,
            so.normalized_weight,
            so.image_url,
            so.kcal_100g,
            s.name AS store_name,
            bp.name AS base_product_name,
            100.0::NUMERIC AS relevance_score
        FROM public.store_offers so
        JOIN public.stores s ON s.id = so.store_id
        JOIN public.base_products bp ON bp.id = so.base_product_id
        ORDER BY (so.promo_price IS NOT NULL) DESC, so.id ASC
        LIMIT result_limit;
        RETURN;
    END IF;

    -- Wyszukiwanie z rankingiem punktowym (Scoring)
    RETURN QUERY
    WITH scored AS (
        SELECT 
            so.id,
            so.name,
            so.regular_price,
            so.promo_price,
            so.normalized_weight,
            so.image_url,
            so.kcal_100g,
            s.name AS store_name,
            bp.name AS base_product_name,
            (
                -- 1. Pełne słowo w nazwie Kategorii Bazowej (np. 'mleko' w 'Mleko UHT 3,2%') -> +120 pkt
                CASE WHEN (' ' || public.norm_text(bp.name) || ' ') LIKE ('% ' || q || ' %') THEN 120.0
                     WHEN (' ' || public.norm_text(bp.name) || ' ') LIKE ('% ' || q || '%') THEN 90.0
                     ELSE 0.0 END
                +
                -- 2. Dopasowanie w synonimach search_tags (np. 'marchewka' -> 'Marchew') -> +100 pkt
                CASE WHEN (' ' || public.norm_text(bp.search_tags) || ' ') LIKE ('% ' || q || ' %') THEN 100.0
                     WHEN (' ' || public.norm_text(bp.search_tags) || ' ') LIKE ('% ' || q || '%') THEN 75.0
                     ELSE 0.0 END
                +
                -- 3. Pełne słowo w nazwie produktu sklepowego (np. 'Mleko Łaciate') -> +60 pkt
                --    Jeśli to tylko kawałek słowa/marki (np. 'Masło Mlekovita') -> tylko +10 pkt!
                CASE WHEN (' ' || public.norm_text(so.name) || ' ') LIKE ('% ' || q || ' %') THEN 60.0
                     WHEN public.norm_text(so.name) LIKE ('%' || q || '%') THEN 10.0
                     ELSE 0.0 END
                +
                -- 4. Podobieństwo rozmyte (Trigramy - literówki i odmiany typu 'marchewka' <-> 'marchew') -> do +50 pkt
                GREATEST(
                    word_similarity(q, public.norm_text(bp.name)),
                    word_similarity(public.norm_text(bp.name), q),
                    word_similarity(q, public.norm_text(bp.search_tags)),
                    word_similarity(q, public.norm_text(so.name))
                ) * 50.0
            )::NUMERIC AS score
        FROM public.store_offers so
        JOIN public.stores s ON s.id = so.store_id
        JOIN public.base_products bp ON bp.id = so.base_product_id
        WHERE 
            -- Warunek wejścia: zawiera ciąg znaków LUB ma wysokie podobieństwo trigramowe (>= 0.38)
            public.norm_text(bp.name) LIKE ('%' || q || '%')
            OR public.norm_text(bp.search_tags) LIKE ('%' || q || '%')
            OR public.norm_text(so.name) LIKE ('%' || q || '%')
            OR word_similarity(q, public.norm_text(bp.name)) >= 0.38
            OR word_similarity(q, public.norm_text(bp.search_tags)) >= 0.38
            OR word_similarity(q, public.norm_text(so.name)) >= 0.42
    )
    SELECT 
        scored.id,
        scored.name,
        scored.regular_price,
        scored.promo_price,
        scored.normalized_weight,
        scored.image_url,
        scored.kcal_100g,
        scored.store_name,
        scored.base_product_name,
        ROUND(scored.score, 1) AS relevance_score
    FROM scored
    WHERE scored.score >= 22.0
    ORDER BY scored.score DESC, COALESCE(scored.promo_price, scored.regular_price) ASC
    LIMIT result_limit;
END;
$$;


ALTER FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."base_products" (
    "id" integer NOT NULL,
    "category_id" integer NOT NULL,
    "name" character varying(120) NOT NULL,
    "default_shelf_life_days" smallint DEFAULT 7 NOT NULL,
    "median_kcal_100g" numeric(6,1),
    "median_protein_100g" numeric(5,1),
    "median_fat_100g" numeric(5,1),
    "median_carbs_100g" numeric(5,1),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "base_products_default_shelf_life_days_check" CHECK (("default_shelf_life_days" > 0)),
    CONSTRAINT "base_products_median_carbs_100g_check" CHECK ((("median_carbs_100g" >= (0)::numeric) AND ("median_carbs_100g" <= (100)::numeric))),
    CONSTRAINT "base_products_median_fat_100g_check" CHECK ((("median_fat_100g" >= (0)::numeric) AND ("median_fat_100g" <= (100)::numeric))),
    CONSTRAINT "base_products_median_kcal_100g_check" CHECK ((("median_kcal_100g" >= (0)::numeric) AND ("median_kcal_100g" <= (905)::numeric))),
    CONSTRAINT "base_products_median_protein_100g_check" CHECK ((("median_protein_100g" >= (0)::numeric) AND ("median_protein_100g" <= (100)::numeric)))
);


ALTER TABLE "public"."base_products" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."base_products_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."base_products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."base_products_id_seq" OWNED BY "public"."base_products"."id";



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" integer NOT NULL,
    "name" character varying(64) NOT NULL,
    "display_order" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."categories_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";



CREATE TABLE IF NOT EXISTS "public"."price_history" (
    "id" bigint NOT NULL,
    "store_offer_id" bigint NOT NULL,
    "regular_price" numeric(10,2),
    "promo_price" numeric(10,2),
    "price_source" character varying(32),
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."price_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."price_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."price_history_id_seq" OWNED BY "public"."price_history"."id";



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" bigint NOT NULL,
    "product_key" character varying(64) NOT NULL,
    "base_product_id" integer NOT NULL,
    "ean" character varying(20),
    "canonical_name" "text" NOT NULL,
    "gramatura_norm" character varying(24),
    "quantity_value" numeric(10,2),
    "quantity_unit" character varying(10),
    "kcal_100g" numeric(6,1),
    "protein_100g" numeric(5,1),
    "fat_100g" numeric(5,1),
    "carbs_100g" numeric(5,1),
    "off_scans" integer DEFAULT 0 NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "products_carbs_100g_check" CHECK ((("carbs_100g" >= (0)::numeric) AND ("carbs_100g" <= (100)::numeric))),
    CONSTRAINT "products_fat_100g_check" CHECK ((("fat_100g" >= (0)::numeric) AND ("fat_100g" <= (100)::numeric))),
    CONSTRAINT "products_kcal_100g_check" CHECK ((("kcal_100g" >= (0)::numeric) AND ("kcal_100g" <= (905)::numeric))),
    CONSTRAINT "products_off_scans_check" CHECK (("off_scans" >= 0)),
    CONSTRAINT "products_protein_100g_check" CHECK ((("protein_100g" >= (0)::numeric) AND ("protein_100g" <= (100)::numeric))),
    CONSTRAINT "products_quantity_unit_check" CHECK ((("quantity_unit")::"text" = ANY ((ARRAY['g'::character varying, 'ml'::character varying, 'szt'::character varying])::"text"[]))),
    CONSTRAINT "products_quantity_value_check" CHECK (("quantity_value" > (0)::numeric))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."products_id_seq" OWNED BY "public"."products"."id";



CREATE TABLE IF NOT EXISTS "public"."store_offers" (
    "id" bigint NOT NULL,
    "offer_key" character varying(64) NOT NULL,
    "store_id" integer NOT NULL,
    "product_id" bigint NOT NULL,
    "store_product_name" "text" NOT NULL,
    "regular_price" numeric(10,2),
    "promo_price" numeric(10,2),
    "promo_type" character varying(64),
    "promo_condition" "text",
    "valid_from" "date",
    "valid_to" "date",
    "price_status" character varying(20) DEFAULT 'brak'::character varying NOT NULL,
    "price_source" character varying(32) DEFAULT 'brak'::character varying NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_promo_lt_regular" CHECK ((("promo_price" IS NULL) OR ("regular_price" IS NULL) OR ("promo_price" < "regular_price"))),
    CONSTRAINT "store_offers_price_status_check" CHECK ((("price_status")::"text" = ANY ((ARRAY['prawdziwa'::character varying, 'estymowana'::character varying, 'brak'::character varying])::"text"[]))),
    CONSTRAINT "store_offers_promo_price_check" CHECK (("promo_price" > (0)::numeric)),
    CONSTRAINT "store_offers_regular_price_check" CHECK (("regular_price" > (0)::numeric))
);


ALTER TABLE "public"."store_offers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."store_offers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."store_offers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."store_offers_id_seq" OWNED BY "public"."store_offers"."id";



CREATE TABLE IF NOT EXISTS "public"."stores" (
    "id" integer NOT NULL,
    "slug" character varying(32) NOT NULL,
    "name" character varying(64) NOT NULL,
    "logo_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."stores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."stores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."stores_id_seq" OWNED BY "public"."stores"."id";



CREATE OR REPLACE VIEW "public"."v_store_offers_full" AS
 SELECT "so"."id" AS "offer_id",
    "s"."id" AS "store_id",
    "s"."slug" AS "store_slug",
    "s"."name" AS "store_name",
    "c"."id" AS "category_id",
    "c"."name" AS "category_name",
    "bp"."id" AS "base_product_id",
    "bp"."name" AS "base_product_name",
    "bp"."default_shelf_life_days",
    "p"."id" AS "product_id",
    "p"."ean",
    "so"."store_product_name" AS "product_name",
    "p"."gramatura_norm",
    "p"."quantity_value",
    "p"."quantity_unit",
    "so"."regular_price",
    (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) AS "is_promo_active",
    (("so"."promo_price" IS NOT NULL) AND ((COALESCE("so"."promo_type", ''::character varying))::"text" ~* '(przy zakupie|gratis|drugi|trzeci|\d+\s*\+\s*\d+|wielopak)'::"text")) AS "is_multibuy_promo",
        CASE
            WHEN (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) THEN "so"."promo_price"
            ELSE NULL::numeric
        END AS "active_promo_price",
        CASE
            WHEN (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) THEN "so"."promo_price"
            ELSE "so"."regular_price"
        END AS "effective_price",
        CASE
            WHEN (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE)) AND (NOT ((COALESCE("so"."promo_type", ''::character varying))::"text" ~* '(przy zakupie|gratis|drugi|trzeci|\d+\s*\+\s*\d+|wielopak)'::"text"))) THEN "so"."promo_price"
            ELSE "so"."regular_price"
        END AS "single_item_price",
        CASE
            WHEN (("so"."promo_price" IS NOT NULL) AND ("so"."regular_price" > (0)::numeric) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) THEN "round"(((("so"."regular_price" - "so"."promo_price") / "so"."regular_price") * (100)::numeric), 0)
            ELSE (0)::numeric
        END AS "discount_pct",
        CASE
            WHEN (("p"."quantity_value" > (0)::numeric) AND (COALESCE("so"."promo_price", "so"."regular_price") IS NOT NULL)) THEN
            CASE
                WHEN (("p"."quantity_unit")::"text" = ANY ((ARRAY['g'::character varying, 'ml'::character varying])::"text"[])) THEN "round"(((
                CASE
                    WHEN (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) THEN "so"."promo_price"
                    ELSE "so"."regular_price"
                END / "p"."quantity_value") * (100)::numeric), 2)
                ELSE "round"((
                CASE
                    WHEN (("so"."promo_price" IS NOT NULL) AND (("so"."valid_from" IS NULL) OR ("so"."valid_from" <= CURRENT_DATE)) AND (("so"."valid_to" IS NULL) OR ("so"."valid_to" >= CURRENT_DATE))) THEN "so"."promo_price"
                    ELSE "so"."regular_price"
                END / "p"."quantity_value"), 2)
            END
            ELSE NULL::numeric
        END AS "price_per_unit_100",
    "so"."promo_type",
    "so"."promo_condition",
    "so"."valid_from",
    "so"."valid_to",
    "so"."price_status",
    "so"."price_source",
    COALESCE("so"."image_url", "p"."image_url") AS "image_url",
    "p"."kcal_100g",
    "p"."protein_100g",
    "p"."fat_100g",
    "p"."carbs_100g",
    "p"."off_scans"
   FROM (((("public"."store_offers" "so"
     JOIN "public"."stores" "s" ON (("s"."id" = "so"."store_id")))
     JOIN "public"."products" "p" ON (("p"."id" = "so"."product_id")))
     JOIN "public"."base_products" "bp" ON (("bp"."id" = "p"."base_product_id")))
     JOIN "public"."categories" "c" ON (("c"."id" = "bp"."category_id")));


ALTER VIEW "public"."v_store_offers_full" OWNER TO "postgres";


ALTER TABLE ONLY "public"."base_products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."base_products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."price_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."price_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."store_offers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."store_offers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."stores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."stores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_ean_key" UNIQUE ("ean");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_product_key_key" UNIQUE ("product_key");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_offer_key_key" UNIQUE ("offer_key");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "uq_store_product" UNIQUE ("store_id", "product_id");



CREATE INDEX "idx_base_products_category" ON "public"."base_products" USING "btree" ("category_id");



CREATE INDEX "idx_price_history_offer_date" ON "public"."price_history" USING "btree" ("store_offer_id", "recorded_at" DESC);



CREATE INDEX "idx_products_base_product" ON "public"."products" USING "btree" ("base_product_id");



CREATE INDEX "idx_products_ean" ON "public"."products" USING "btree" ("ean") WHERE ("ean" IS NOT NULL);



CREATE INDEX "idx_products_name_trgm" ON "public"."products" USING "gin" ("canonical_name" "public"."gin_trgm_ops");



CREATE INDEX "idx_store_offers_active_promo" ON "public"."store_offers" USING "btree" ("store_id", "valid_to") WHERE ("promo_price" IS NOT NULL);



CREATE INDEX "idx_store_offers_prices" ON "public"."store_offers" USING "btree" ("store_id", "regular_price") WHERE ("regular_price" IS NOT NULL);



CREATE INDEX "idx_store_offers_store_product" ON "public"."store_offers" USING "btree" ("store_id", "product_id");



CREATE OR REPLACE TRIGGER "trg_log_price_change" AFTER INSERT OR UPDATE ON "public"."store_offers" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_price_change"();



CREATE OR REPLACE TRIGGER "trg_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_store_offers_updated_at" BEFORE UPDATE ON "public"."store_offers" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



ALTER TABLE ONLY "public"."base_products"
    ADD CONSTRAINT "base_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."price_history"
    ADD CONSTRAINT "price_history_store_offer_id_fkey" FOREIGN KEY ("store_offer_id") REFERENCES "public"."store_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_base_product_id_fkey" FOREIGN KEY ("base_product_id") REFERENCES "public"."base_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."store_offers"
    ADD CONSTRAINT "store_offers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



CREATE POLICY "Public read base_products" ON "public"."base_products" FOR SELECT USING (true);



CREATE POLICY "Public read categories" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Public read price_history" ON "public"."price_history" FOR SELECT USING (true);



CREATE POLICY "Public read products" ON "public"."products" FOR SELECT USING (true);



CREATE POLICY "Public read store_offers" ON "public"."store_offers" FOR SELECT USING (true);



CREATE POLICY "Public read stores" ON "public"."stores" FOR SELECT USING (true);



ALTER TABLE "public"."base_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."store_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stores" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."norm_text"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."norm_text"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."norm_text"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_offers"("search_query" "text", "result_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."base_products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."base_products" TO "authenticated";
GRANT ALL ON TABLE "public"."base_products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."base_products_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_history" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."price_history" TO "authenticated";
GRANT ALL ON TABLE "public"."price_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."price_history_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."store_offers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."store_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."store_offers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."store_offers_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stores" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stores" TO "authenticated";
GRANT ALL ON TABLE "public"."stores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."stores_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."v_store_offers_full" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."v_store_offers_full" TO "authenticated";
GRANT ALL ON TABLE "public"."v_store_offers_full" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































