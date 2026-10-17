/**
 * Memoria del telefono (IndexedDB) per le foto in attesa di invio.
 * Restano qui solo finché non sono salvate nell'archivio della ditta, poi si cancellano.
 */
const NOME_DB = 'foto-cantieri'
const RACCOLTA = 'coda'

let aperto: Promise<IDBDatabase> | null = null

function apri(): Promise<IDBDatabase> {
  aperto ??= new Promise((ok, ko) => {
    const r = indexedDB.open(NOME_DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(RACCOLTA, { keyPath: 'id' })
    r.onsuccess = () => ok(r.result)
    r.onerror = () => ko(r.error)
  })
  return aperto
}

async function operazione<T>(modo: IDBTransactionMode, azione: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await apri()
  return new Promise((ok, ko) => {
    const tx = db.transaction(RACCOLTA, modo)
    const r = azione(tx.objectStore(RACCOLTA))
    tx.oncomplete = () => ok(r.result)
    tx.onerror = () => ko(tx.error)
    tx.onabort = () => ko(tx.error)
  })
}

export const memoria = {
  tutte: <T>() => operazione<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>),
  salva: <T>(voce: T) => operazione('readwrite', (s) => s.put(voce)).then(() => undefined),
  elimina: (id: string) => operazione('readwrite', (s) => s.delete(id)).then(() => undefined),
}
