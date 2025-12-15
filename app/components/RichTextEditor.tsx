import React from 'react';
import { ClientOnly } from './ClientOnly';

const ReactQuill = React.lazy(() => import('react-quill'));
import 'react-quill/dist/quill.snow.css';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange }) => {
  return (
    <ClientOnly>
      <React.Suspense fallback={<div>Loading...</div>}>
        <ReactQuill
          theme="snow"
          value={value}
          onChange={onChange}
          modules={{
            clipboard: {
              matchVisual: false,
            },
            toolbar: [
              [{ 'header': '1'}, {'header': '2'}, { 'font': [] }],
              [{size: []}],
              ['bold', 'italic', 'underline', 'strike', 'blockquote'],
              [{'list': 'ordered'}, {'list': 'bullet'}, 
               {'indent': '-1'}, {'indent': '+1'}],
              ['link', 'image', 'video'],
              ['clean']
            ],
          }}
        />
      </React.Suspense>
    </ClientOnly>
  );
};

export default RichTextEditor;
