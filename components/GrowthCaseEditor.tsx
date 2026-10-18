'use client';
import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import type { RichNode } from '@/lib/growth-case-domain';
import styles from './GrowthCaseLog.module.css';

export default function GrowthCaseEditor({label,value,caseId,onChange,onUploading,disabled=false}:{label:string;value:RichNode;caseId:string;onChange:(value:RichNode)=>void;onUploading:(busy:boolean)=>void;disabled?:boolean}) {
  const input=useRef<HTMLInputElement>(null);
  const [error,setError]=useState('');
  const [uploading,setUploading]=useState(false);
  const change=useRef(onChange); change.current=onChange;
  const upload=useRef<(file:File)=>Promise<void>>(async()=>{});
  const editor=useEditor({
    extensions:[StarterKit.configure({link:false,codeBlock:false,horizontalRule:false}),Image,TableKit.configure({table:{resizable:false}})],
    immediatelyRender:false, content:value,
    onUpdate:({editor})=>change.current(editor.getJSON() as RichNode),
    editorProps:{attributes:{'aria-label':label,role:'textbox','aria-multiline':'true'},
      handlePaste:(_view,event)=>{const file=Array.from(event.clipboardData?.files || []).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();void upload.current(file);return true;}return false;},
      handleDrop:(_view,event)=>{const file=Array.from(event.dataTransfer?.files || []).find(f=>f.type.startsWith('image/'));if(file){event.preventDefault();void upload.current(file);return true;}return false;},
    },
  });
  useEffect(()=>{editor?.setEditable(!disabled && !uploading,false);},[editor,disabled,uploading]);
  upload.current=async(file:File)=>{
    if(disabled || uploading)return;
    setError('');setUploading(true);onUploading(true);
    try {
      if(file.size>5_242_880)throw new Error('Gambar maksimal 5 MB.');
      const body=new FormData();body.append('file',file);
      const response=await fetch(`/api/growth-cases/${caseId}/images`,{method:'POST',body});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      editor?.chain().focus().setImage({src:data.src,alt:file.name.slice(0,500)}).run();
    }catch(err){setError(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');}
    finally{setUploading(false);onUploading(false);if(input.current)input.current.value='';}
  };
  const tool=(text:string,action:()=>void,active=false)=><button type="button" className={active ? styles.activeTool : ''} disabled={!editor || disabled || uploading} onClick={action}>{text}</button>;
  return <section className={styles.editorField}>
    <h3>{label}</h3><div className={styles.editorShell}>
      <div className={styles.toolbar} aria-label={`Format ${label}`}>
        {tool('Tebal',()=>editor?.chain().focus().toggleBold().run(),editor?.isActive('bold'))}
        {tool('Miring',()=>editor?.chain().focus().toggleItalic().run(),editor?.isActive('italic'))}
        {tool('Judul',()=>editor?.chain().focus().toggleHeading({level:3}).run(),editor?.isActive('heading'))}
        {tool('Daftar',()=>editor?.chain().focus().toggleBulletList().run(),editor?.isActive('bulletList'))}
        {tool('Gambar',()=>input.current?.click())}
        {tool('Tabel',()=>editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run())}
        {editor?.isActive('table') && <>
          {tool('+ Baris',()=>editor?.chain().focus().addRowAfter().run())}{tool('+ Kolom',()=>editor?.chain().focus().addColumnAfter().run())}
          {tool('Hapus baris',()=>editor?.chain().focus().deleteRow().run())}{tool('Hapus kolom',()=>editor?.chain().focus().deleteColumn().run())}
          {tool('Hapus tabel',()=>editor?.chain().focus().deleteTable().run())}
        </>}
        {tool('Urungkan',()=>editor?.chain().focus().undo().run())}{tool('Ulangi',()=>editor?.chain().focus().redo().run())}
      </div>
      <EditorContent editor={editor} className={styles.editorContent}/>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void upload.current(file);}} aria-label={`Unggah gambar ${label}`}/>
    </div>
    {uploading && <p role="status" className={styles.muted}>Mengunggah gambar…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
