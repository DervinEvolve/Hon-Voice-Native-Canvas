import { Template } from '../../types';

export const comicTemplates: Template[] = [
  {
    id: 'classic-4',
    name: 'Classic 4-Panel',
    description: '2x2 grid, perfect for short stories',
    icon: 'Grid',
    layout: {
      rows: 2,
      cols: 2,
      areas: [
        { size: 'medium', position: { row: 0, col: 0 } },
        { size: 'medium', position: { row: 0, col: 1 } },
        { size: 'medium', position: { row: 1, col: 0 } },
        { size: 'medium', position: { row: 1, col: 1 } },
      ],
    },
  },
  {
    id: 'manga-style',
    name: 'Manga Style',
    description: 'Dynamic layout with varied panel sizes',
    icon: 'LayoutTemplate',
    layout: {
      rows: 2,
      cols: 3,
      areas: [
        { size: 'large', position: { row: 0, col: 0, rowSpan: 2, colSpan: 2 } },
        { size: 'small', position: { row: 0, col: 2 } },
        { size: 'small', position: { row: 1, col: 2 } },
      ],
    },
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    description: 'Widescreen panels for dramatic effect',
    icon: 'Monitor',
    layout: {
      rows: 3,
      cols: 1,
      areas: [
        { size: 'large', position: { row: 0, col: 0 } },
        { size: 'large', position: { row: 1, col: 0 } },
        { size: 'large', position: { row: 2, col: 0 } },
      ],
    },
  },
  {
    id: 'dynamic-6',
    name: 'Dynamic 6-Panel',
    description: 'Varied sizes for visual interest',
    icon: 'LayoutGrid',
    layout: {
      rows: 3,
      cols: 3,
      areas: [
        { size: 'medium', position: { row: 0, col: 0, colSpan: 2 } },
        { size: 'small', position: { row: 0, col: 2 } },
        { size: 'small', position: { row: 1, col: 0 } },
        { size: 'medium', position: { row: 1, col: 1, colSpan: 2 } },
        { size: 'small', position: { row: 2, col: 0 } },
        { size: 'medium', position: { row: 2, col: 1, colSpan: 2 } },
      ],
    },
  },
];