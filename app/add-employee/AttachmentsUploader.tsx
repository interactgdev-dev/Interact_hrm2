import React from "react";
import { useRouter } from "next/navigation";
import styles from "./add-employee.module.css";

export default function AttachmentsUploader({ employeeId }: { employeeId: string }) {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [fileList, setFileList] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const router = useRouter();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleAddFile = () => {
    if (selectedFile) {
      setFileList(prev => [...prev, selectedFile]);
      setSelectedFile(null);
    }
  };

  const handleRemoveFile = (idx: number) => {
    setFileList(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow saving without attachments - skip if no files
    if (fileList.length === 0) {
      alert('No attachments to upload. Redirecting to employee list.');
      router.push('/admin/employee-list');
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('employee_id', employeeId);
    fileList.forEach(f => formData.append('files', f));
    const res = await fetch('/api/attachments', {
      method: 'POST',
      body: formData,
    });
    setUploading(false);
    if (res.ok) {
      alert('Attachments uploaded successfully!');
      router.push('/admin/employee-list');
    } else {
      const data = await res.json();
      alert('Upload failed: ' + (data.error || 'Unknown error'));
    }
  };

  return (
    <form className={styles.form} style={{ width: '100%' }} onSubmit={handleSave}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Upload PDF Documents (Max 100MB each)
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          className={styles.input}
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
        />
        <button type="button" onClick={handleAddFile} disabled={!selectedFile} style={{ background: '#FFA726', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: selectedFile ? 'pointer' : 'not-allowed' }}>Add</button>
      </div>
      {fileList.length > 0 && (
        <ul style={{ marginBottom: 16 }}>
          {fileList.map((file, idx) => (
            <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{file.name}</span>
              <button type="button" onClick={() => handleRemoveFile(idx)} style={{ color: '#C00', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="submit" disabled={uploading} style={{ background: '#8BC34A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 32px', fontWeight: 600, fontSize: '1.08rem', cursor: uploading ? 'not-allowed' : 'pointer', boxShadow: '0 2px 8px rgba(0,82,204,0.10)' }}>Save</button>
      </div>
    </form>
  );
}
