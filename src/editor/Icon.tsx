const paths = {
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  hidden: 'M3 3l18 18 M9 5.5A12 12 0 0 1 12 5c7 0 10 7 10 7a18 18 0 0 1-4 4 M6 7c-3 2-4 5-4 5s3 7 10 7c2 0 3.5-.4 5-1.2',
  save: 'M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8',
  undo: 'M9 4 3 10l6 6 M3 10h11a7 7 0 0 1 7 7v3',
  redo: 'm15 4 6 6-6 6 M21 10H10a7 7 0 0 0-7 7v3',
  play: 'm8 4 12 8-12 8V4Z', pause: 'M7 4v16 M17 4v16',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  chevron: 'm7 10 5 5 5-5', close: 'm6 6 12 12 M6 18 18 6',
  folder: 'M3 7V4h6l2 3h10v13H3V7Z',
  copy: 'M8 8h13v13H8V8Z M16 8V3H3v13h5',
  live: 'M3 7h12v10H3V7Z M15 10l6-3v10l-6-3',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  face: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M9 10h.01 M15 10h.01 M8.5 14.5a4 4 0 0 0 7 0',
  pose: 'M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z M5 9l7 1 7-1 M12 10v5 M8 21l4-6 4 6',
  mouth: 'M3 12c3-4 6-4 9-2 3-2 6-2 9 2-3 5-15 5-18 0Z M3 12h18',
  brush: 'M4 20h4L19 9l-4-4L4 16v4Z M13 7l4 4',
  light: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
