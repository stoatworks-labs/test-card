/**
 * The picture the `image` pattern draws, kept across a refresh.
 *
 * Not in localStorage with the rest of the state: an image as a data URL would
 * blow the quota on the first photo, and the store's own note says never to
 * keep anything rendered there. IndexedDB holds a Blob as it is. Every call is
 * wrapped, because private browsing, a full disk or a blocked origin can each
 * refuse — and losing the image on refresh is an inconvenience, not an error.
 */

const DB = 'test-card'
const STORE = 'image'
const KEY = 'current'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = f(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function saveImage(blob: Blob, name: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.put({ blob, name }, KEY))
    announce()
  } catch {
    // Not persisted; it still works until the page is closed.
  }
}

export async function loadImage(): Promise<{ blob: Blob; name: string } | null> {
  try {
    const v = (await run('readonly', (s) => s.get(KEY))) as { blob: Blob; name: string } | undefined
    return v && v.blob instanceof Blob ? v : null
  } catch {
    return null
  }
}

export async function clearImage(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY))
    announce()
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}

// Live windows draw the same picture, and learn it has changed from here: the
// stored copy is the one they read, so the news goes out once it is stored.
const CHANNEL = 'test-card/image'

function announce() {
  if (typeof BroadcastChannel === 'undefined') return
  const ch = new BroadcastChannel(CHANNEL)
  ch.postMessage('changed')
  ch.close()
}

/** Calls `f` whenever another page stores or clears the image. */
export function onImageChanged(f: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = () => f()
  return () => ch.close()
}

/** Decode a file into something a canvas can draw, honouring EXIF rotation. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}
