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
    <div data-testid="file-upload">
      <button
        data-testid="upload-btn"
        onClick={() => inputRef.current?.click()}
        aria-label={`Upload ${accept} file`}
        style={{ fontSize: 12 }}
        type="button"
      >
        {label}
      </button>
      <input
        data-testid="file-input"
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  )
}
