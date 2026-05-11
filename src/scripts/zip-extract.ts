/**
 * zip-extract.ts
 * Extraction d'une entrée nommée depuis un fichier ZIP — pur Node.js (Buffer + zlib).
 * Aucune dépendance système (pas de `unzip`, pas de `python3`).
 *
 * Gère les ZIP standard ET les ZIP à central directory décalé (ex. L1300 OLL AMP).
 */

import { readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';

/**
 * Extrait une entrée nommée d'un ZIP et retourne son contenu décompressé.
 * Throw si l'entrée est introuvable ou si la décompression échoue.
 */
export function extractFromZip(zipPath: string, entryName: string): Buffer {
  const data = readFileSync(zipPath);
  return extractEntry(data, entryName, zipPath);
}

function extractEntry(data: Buffer, entryName: string, zipPath: string): Buffer {
  // 1. Trouver l'EOCD (End of Central Directory) — signature PK\x05\x06
  const eocdPos = findEocd(data);
  if (eocdPos === -1) {
    throw new Error(`ZIP invalide — EOCD introuvable : ${zipPath}`);
  }

  const cdCount  = data.readUInt16LE(eocdPos + 10);
  let   cdOffset = data.readUInt32LE(eocdPos + 16);

  // 2. Valider l'offset du central directory
  if (!isCdSig(data, cdOffset)) {
    // L'offset EOCD pointe au mauvais endroit (ex. L1300 ZIP non-standard).
    // Scan arrière depuis l'EOCD pour trouver le premier PK\x01\x02 réel.
    const found = scanCdBackward(data, eocdPos);
    if (found === -1) {
      throw new Error(`Central directory introuvable dans : ${zipPath}`);
    }
    cdOffset = found;
  }

  // 3. Parcourir les entrées du central directory
  let pos = cdOffset;
  for (let n = 0; n < cdCount + 5; n++) {
    if (!isCdSig(data, pos)) break;

    const method     = data.readUInt16LE(pos + 10);
    const csize      = data.readUInt32LE(pos + 20);
    const usize      = data.readUInt32LE(pos + 24);
    const fnLen      = data.readUInt16LE(pos + 28);
    const extraLen   = data.readUInt16LE(pos + 30);
    const commentLen = data.readUInt16LE(pos + 32);
    const lfOffset   = data.readUInt32LE(pos + 42);
    const fname      = data.slice(pos + 46, pos + 46 + fnLen).toString('latin1');

    if (fname === entryName) {
      // Lire la taille extra du local file header (peut différer du CD)
      const lfFnLen    = data.readUInt16LE(lfOffset + 26);
      const lfExtraLen = data.readUInt16LE(lfOffset + 28);
      const payloadStart = lfOffset + 30 + lfFnLen + lfExtraLen;
      const payload    = data.slice(payloadStart, payloadStart + csize);

      if (method === 0) return payload;           // stored (non compressé)
      if (method === 8) return inflateRawSync(payload); // deflate
      throw new Error(`Méthode de compression non supportée (${method}) pour "${entryName}"`);
    }

    pos += 46 + fnLen + extraLen + commentLen;
  }

  throw new Error(
    `Entrée "${entryName}" introuvable dans ${zipPath}.\n` +
    `Vérifier le nom exact du fichier CSV dans le ZIP.`,
  );
}

function findEocd(data: Buffer): number {
  // L'EOCD est dans les 66 Ko de fin du fichier (max ZIP comment = 65535 bytes)
  const searchFrom = Math.max(0, data.length - 66000);
  for (let i = data.length - 22; i >= searchFrom; i--) {
    if (data[i] === 0x50 && data[i+1] === 0x4b && data[i+2] === 0x05 && data[i+3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function isCdSig(data: Buffer, pos: number): boolean {
  return (
    pos >= 0 &&
    pos + 4 <= data.length &&
    data[pos] === 0x50 && data[pos+1] === 0x4b &&
    data[pos+2] === 0x01 && data[pos+3] === 0x02
  );
}

function scanCdBackward(data: Buffer, eocdPos: number): number {
  // Scan arrière dans les 200 Ko précédant l'EOCD pour trouver le PREMIER PK\x01\x02
  // (le plus petit offset = début du central directory).
  // On ne s'arrête PAS au premier match trouvé en remontant (qui serait la dernière entrée).
  const limit = Math.max(0, eocdPos - 200000);
  let earliest = -1;
  for (let i = eocdPos - 4; i >= limit; i--) {
    if (isCdSig(data, i)) earliest = i;
  }
  return earliest;
}
