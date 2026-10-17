import { describe, expect, it } from 'vitest'

describe('emulatori', () => {
  it('la Function "salute" risponde', async () => {
    const r = await fetch('http://127.0.0.1:5001/demo-foto-cantieri/europe-west1/salute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: null }),
    })
    expect(r.status).toBe(200)
    const corpo = await r.json()
    expect(corpo.result.ok).toBe(true)
  })
})
