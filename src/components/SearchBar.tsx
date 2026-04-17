'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export default function SearchBar() {
  const [value, setValue] = useState('')
  const router = useRouter()

  const handleSearch = () => {
    const slug = slugify(value.trim())
    if (slug) router.push(`/communes/${slug}`)
  }

  return (
    <div className="flex border-2 border-ink w-full max-w-xl">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        placeholder="Nom de commune…"
        className="flex-1 px-4 py-3 font-mono text-sm text-ink bg-paper placeholder:text-ink-muted outline-none"
      />
      <button
        onClick={handleSearch}
        className="border-l-2 border-ink px-5 py-3 font-mono text-xs tracking-wider uppercase bg-ink text-paper hover:bg-accent hover:border-accent transition-colors"
      >
        Rechercher
      </button>
    </div>
  )
}
