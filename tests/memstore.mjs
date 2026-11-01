// In-memory store with the same interface as the Netlify Blobs wrapper (for tests and local dev).
export function memStore() {
  const m = new Map();
  return {
    m,
    getJSON: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); },
    getBin: async (k) => (m.has(k) ? m.get(k) : null),
    setBin: async (k, data, type) => { m.set(k, { data, type }); },
    del: async (k) => { m.delete(k); },
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  };
}
