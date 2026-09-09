/**
 * A zip file, built by hand.
 *
 * There is no zip in the Workers runtime and no dependency here that provides
 * one, so this writes the format directly. It is about eighty lines because
 * zip is a simple container: a header before each file, the file, and a
 * directory at the end listing where each one started.
 *
 * **Deflate comes from the platform.** `CompressionStream('deflate-raw')` is
 * the exact payload a zip entry wants — raw deflate with no zlib wrapper — so
 * the only thing written here is the framing and the CRC.
 *
 * Every entry is buffered whole rather than streamed. That is a deliberate
 * limit: it means the sizes are known before the header is written, so no data
 * descriptors and no second pass, and it is safe because the thing this exists
 * to package is a register of a few megabytes. A backup of a gigabyte would
 * need the streaming form, and would also need somewhere better to put it than
 * a browser download.
 */

/** Table-free CRC-32, which is fast enough for a few megabytes and far shorter. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Through a Response rather than a Blob: `Blob` is typed for the DOM and this
  // runs on Workers, where a Response body is the stream primitive that is
  // always there.
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ZipEntry {
  /** Path inside the archive. Forward slashes, no leading slash. */
  name: string;
  body: string | Uint8Array;
}

/**
 * MS-DOS date and time, which is what the format stores.
 *
 * Two-second resolution and a 1980 epoch, both of which are facts about zip
 * rather than choices. A wrong value here shows as a wrong timestamp in a file
 * listing and nothing worse, but the manifest carries the real one.
 */
function dosStamp(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export async function makeZip(entries: ZipEntry[], at = new Date()): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const { time, date } = dosStamp(at);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = typeof entry.body === 'string' ? encoder.encode(entry.body) : entry.body;
    const packed = await deflate(raw);
    const sum = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header
    local.setUint16(4, 20, true);           // version needed: 2.0, deflate
    local.setUint16(6, 0x0800, true);       // UTF-8 names
    local.setUint16(8, 8, true);            // method: deflate
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // no extra field
    chunks.push(new Uint8Array(local.buffer), name, packed);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory header
    dir.setUint16(4, 20, true);             // version made by
    dir.setUint16(6, 20, true);             // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 8, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, sum, true);
    dir.setUint32(20, packed.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);        // where the local header sits
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + packed.length;
  }

  const directory = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directory, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at2 = 0;
  for (const chunk of all) { out.set(chunk, at2); at2 += chunk.length; }
  return out;
}
