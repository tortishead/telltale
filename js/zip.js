/* ================ loading a dump ================ */

/* ---- `adb bugreport`, which is a zip ------------------------------------
   `adb bugreport <dir>` writes a zip, not a text file: the flat bugreport.txt
   only comes out of `adb bugreport > file.txt` on older platform tools. So the
   thing people actually have is the zip, and it holds the whole dump as one
   entry beside the files dumpstate collected — FS/, proto/, a couple of
   screenshots.

   Reading it needs no library. The archive index is at the end of the file,
   every entry says where its bytes are, and the browser inflates them:
   DecompressionStream('deflate-raw') is the same decoder the network stack
   uses. What follows is that and nothing else — no writing, no encryption, no
   zip64, each of which is reported rather than half-supported. */

const ZIP_LOCAL = 0x04034b50, ZIP_CD = 0x02014b50, ZIP_EOCD = 0x06054b50;
const ZIP_MAX_COMMENT = 0xffff;

const isZip = (bytes) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b
                      && bytes[2] === 0x03 && bytes[3] === 0x04;

/* The end-of-central-directory record is the last thing in the file, except
   for a comment nobody writes, so it is found by scanning back for its
   signature rather than by arithmetic. */
function zipEocd(view){
  const end = view.byteLength;
  const floor = Math.max(0, end - ZIP_MAX_COMMENT - 22);
  for(let i = end - 22; i >= floor; i--){
    if(view.getUint32(i, true) === ZIP_EOCD) return i;
  }
  return -1;
}

/* Every entry in the archive index: its name, where its bytes start, how many
   there are and how they were packed. The index is read rather than the local
   headers, because only the index is guaranteed to carry the sizes. */
function zipIndex(buf){
  const view = new DataView(buf);
  const at = zipEocd(view);
  if(at < 0) throw new Error('that zip has no index in it, so it is either truncated or not a zip');

  const count = view.getUint16(at + 10, true);
  const cdAt = view.getUint32(at + 16, true);
  if(cdAt === 0xffffffff || count === 0xffff){
    throw new Error('that zip is in the zip64 format, which Telltale does not read. '
      + 'Unzip it and drop the bugreport txt in instead');
  }

  const out = [];
  let p = cdAt;
  for(let i = 0; i < count && p + 46 <= buf.byteLength; i++){
    if(view.getUint32(p, true) !== ZIP_CD) break;
    const method = view.getUint16(p + 10, true);
    const flags = view.getUint16(p + 8, true);
    const packed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    /* A truncated archive — a download that stopped, or a zip inside a zip cut
       at the wrong byte — has an index that runs off the end of the file. The
       entries read so far are still good, so the index stops here and says so
       by what it hands back rather than by a RangeError out of Uint8Array. */
    if(p + 46 + nameLen > buf.byteLength) break;
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    out.push({ name, method, packed, size, localAt, encrypted: !!(flags & 1) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* An entry's bytes start after its local header, whose name and extra fields
   are their own lengths again — the index's copy of them is allowed to differ,
   so the local ones are the ones that count. */
async function zipRead(buf, entry, onBytes){
  const view = new DataView(buf);
  if(entry.encrypted) throw new Error(`${entry.name} is encrypted`);
  /* Every offset here comes out of the file being read, so none of it is
     believed before it is used: a header that starts past the end of the
     archive, or an entry whose packed bytes run off it, is a truncated zip and
     is told as one. Reaching for those bytes unchecked would throw a
     RangeError with nothing in it about which file or why. */
  const truncated = () => new Error(`${entry.name} runs past the end of that zip, `
    + 'so the archive is truncated');
  if(entry.localAt < 0 || entry.localAt + 30 > buf.byteLength) throw truncated();
  if(view.getUint32(entry.localAt, true) !== ZIP_LOCAL){
    throw new Error(`${entry.name} is not where the index says it is`);
  }
  const nameLen = view.getUint16(entry.localAt + 26, true);
  const extraLen = view.getUint16(entry.localAt + 28, true);
  const from = entry.localAt + 30 + nameLen + extraLen;
  if(from + entry.packed > buf.byteLength) throw truncated();
  const bytes = new Uint8Array(buf, from, entry.packed);

  if(entry.method === 0) return new TextDecoder().decode(bytes);
  if(entry.method !== 8) throw new Error(`${entry.name} is packed in a way Telltale cannot read`);
  if(typeof DecompressionStream !== 'function'){
    throw new Error('this browser cannot unzip; unzip the bugreport and drop the txt in instead');
  }
  /* Inflating a bugreport's text is a few seconds on its own, and the only
     thing that knows how far through it is, is how much of the packed entry
     has been fed in — so the bytes are counted on their way past. */
  const counted = onBytes
    ? new Blob([bytes]).stream().pipeThrough(new TransformStream({
        transform(chunk, ctl){ onBytes(chunk.byteLength, entry.packed); ctl.enqueue(chunk); },
      }))
    : new Blob([bytes]).stream();
  const stream = counted.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/* Which entry is the bugreport. dumpstate names it `bugreport-<device>-<build>
   -<date>.txt` and writes that name into `main_entry.txt`, so that file is
   asked first and the name is matched only when it is not there. Everything
   else in the archive is what dumpstate collected, not what it wrote. */
const ZIP_BUGREPORT_RE = /(?:^|\/)bugreport[^/]*\.txt$/i;

async function zipPickDump(buf, onBytes){
  const entries = zipIndex(buf).filter(e => !e.name.endsWith('/'));
  if(!entries.length) throw new Error('that zip is empty');

  const byName = (name) => entries.find(e => e.name === name || e.name.endsWith('/' + name));
  const main = byName('main_entry.txt');
  if(main){
    const named = (await zipRead(buf, main)).trim().split(/\s+/)[0];
    const hit = named && entries.find(e => e.name === named || e.name.endsWith('/' + named));
    if(hit) return { name: hit.name, text: await zipRead(buf, hit, onBytes) };
  }

  const biggest = (list) => list.slice().sort((a, b) => b.size - a.size)[0];
  const named = biggest(entries.filter(e => ZIP_BUGREPORT_RE.test(e.name)));
  if(named) return { name: named.name, text: await zipRead(buf, named, onBytes) };

  /* No file in it is called a bugreport. The largest text file still stands a
     good chance of being a dump, and reading it is a better answer than
     refusing an archive somebody rearranged. */
  const txt = biggest(entries.filter(e => /\.(txt|log|dump|out)$/i.test(e.name)));
  if(txt) return { name: txt.name, text: await zipRead(buf, txt, onBytes) };

  throw new Error('there is no text file in that zip');
}
