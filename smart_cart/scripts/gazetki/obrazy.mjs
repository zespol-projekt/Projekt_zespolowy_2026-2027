// Rozpoznanie i sprawdzenie obrazów stron gazetek (bez zewnętrznych bibliotek).
// Limity zgodne z kontraktem czytnika (leaflets-contract.md) i migracją 20261120000100_leaflets.sql.
import crypto from 'node:crypto';

export const LIMITY = { bajty: 8 * 1024 * 1024, bok: 8192, piksele: 30_000_000 };
export const ROZSZERZENIA = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function wymiaryPng(b) {
  if (b.length < 24 || b.readUInt32BE(12) !== 0x49484452) return null; // IHDR
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function wymiaryJpeg(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const znacznik = b[i + 1];
    if (znacznik === 0xd8 || znacznik === 0x01 || (znacznik >= 0xd0 && znacznik <= 0xd7)) { i += 2; continue; }
    const dlugosc = b.readUInt16BE(i + 2);
    // SOF0-SOF15 bez DHT (C4), JPG (C8) i DAC (CC).
    if (znacznik >= 0xc0 && znacznik <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(znacznik)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + dlugosc;
  }
  return null;
}

function wymiaryWebp(b) {
  if (b.length < 30) return null;
  const rodzaj = b.toString('ascii', 12, 16);
  if (rodzaj === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (rodzaj === 'VP8L') {
    const v = b.readUInt32LE(21);
    return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
  }
  if (rodzaj === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

/** Typ obrazu po faktycznych bajtach (nie po nagłówku HTTP ani rozszerzeniu). */
export function typObrazu(b) {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Opis strony gotowy do zapisu albo wyjątek z powodem odrzucenia. */
export function opiszObraz(bufor) {
  const mime = typObrazu(bufor);
  if (!mime) throw new Error('to nie jest obraz PNG, JPEG ani WebP');
  if (bufor.length > LIMITY.bajty) throw new Error(`obraz ma ${bufor.length} B, limit ${LIMITY.bajty} B`);
  const w = mime === 'image/png' ? wymiaryPng(bufor) : mime === 'image/jpeg' ? wymiaryJpeg(bufor) : wymiaryWebp(bufor);
  if (!w || !w.width || !w.height) throw new Error('nie da się odczytać wymiarów obrazu');
  if (w.width > LIMITY.bok || w.height > LIMITY.bok) throw new Error(`bok obrazu ponad ${LIMITY.bok} px`);
  if (w.width * w.height > LIMITY.piksele) throw new Error('obraz ma ponad 30 mln pikseli');
  return { mime, width: w.width, height: w.height, bajty: bufor.length,
    sha256: crypto.createHash('sha256').update(bufor).digest('hex'), rozszerzenie: ROZSZERZENIA[mime] };
}
