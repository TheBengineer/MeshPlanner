import { useRef } from 'react'

interface FileUploadProps {
  onFile: (content: string, filename: string) => void
  accept?: string
  label?: string
}

export function FileUpload({ onFile, accept = '.csv,.geojson,.json', label = 'Upload File' }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onFile(reader.result as string, file.name)
    reader.readAsText(file)
    // Reset so the same file can be re-uploaded
    e.target.value = ''
  }

  return (
    <div>
      <button onClick={() => inputRef.current?.click()} style={{ fontSize: 12 }}>{label}</button>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} style={{ display: 'none' }} />
    </div>
  )
}
