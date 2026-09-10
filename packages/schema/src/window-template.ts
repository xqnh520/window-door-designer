import { z } from 'zod';
import { ComponentKindSchema } from './design-model.js';
import { WindowTypeSchema } from './material.js';

export const TemplateComponentSchema = z.object({
  id: z.string(),
  kind: ComponentKindSchema,
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  wRatio: z.number().positive().max(1),
  hRatio: z.number().positive().max(1),
  parentId: z.string().optional(),
  windowType: WindowTypeSchema.optional(),
  hingeSide: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  openDirection: z.enum(['in', 'out']).optional(),
  label: z.string().optional(),
});

export type TemplateComponent = z.infer<typeof TemplateComponentSchema>;

export const WindowTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['fixed', 'casement', 'sliding', 'topHung', 'view', 'custom']),
  allowedFamilies: z.array(z.enum(['fixed', 'casement', 'sliding', 'mixed'])).default(['mixed']),
  components: z.array(TemplateComponentSchema),
});

export type WindowTemplate = z.infer<typeof WindowTemplateSchema>;

export const sampleWindowTemplates: WindowTemplate[] = [
  {
    id: 'tpl-fixed-single',
    name: '单固定窗',
    type: 'fixed',
    allowedFamilies: ['fixed', 'casement', 'mixed'],
    components: [
      { id: 'frame', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
      { id: 'glass-1', kind: 'fixedGlass', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1, parentId: 'frame', windowType: 'fixed', label: 'F1' },
    ],
  },
  {
    id: 'tpl-fixed-casement-right',
    name: '一固定一平开',
    type: 'casement',
    allowedFamilies: ['casement', 'mixed'],
    components: [
      { id: 'frame', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
      { id: 'mullion-1', kind: 'mullion', xRatio: 0.45, yRatio: 0, wRatio: 0.01, hRatio: 1, parentId: 'frame' },
      { id: 'glass-1', kind: 'fixedGlass', xRatio: 0, yRatio: 0, wRatio: 0.45, hRatio: 1, parentId: 'frame', windowType: 'fixed', label: 'F1' },
      { id: 'sash-1', kind: 'casementSash', xRatio: 0.45, yRatio: 0, wRatio: 0.55, hRatio: 1, parentId: 'frame', windowType: 'casement', hingeSide: 'right', openDirection: 'out', label: 'A1' },
    ],
  },
  {
    id: 'tpl-sliding-two-sash',
    name: '两轨两扇推拉',
    type: 'sliding',
    allowedFamilies: ['sliding', 'mixed'],
    components: [
      { id: 'frame', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
      { id: 'sash-l', kind: 'slidingSash', xRatio: 0, yRatio: 0, wRatio: 0.5, hRatio: 1, parentId: 'frame', windowType: 'sliding', label: 'S1' },
      { id: 'sash-r', kind: 'slidingSash', xRatio: 0.5, yRatio: 0, wRatio: 0.5, hRatio: 1, parentId: 'frame', windowType: 'sliding', label: 'S2' },
    ],
  },
  {
    id: 'tpl-top-hung-single',
    name: '单上悬窗',
    type: 'topHung',
    allowedFamilies: ['casement', 'mixed'],
    components: [
      { id: 'frame', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
      { id: 'sash-1', kind: 'topHungSash', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1, parentId: 'frame', windowType: 'topHinged', hingeSide: 'top', openDirection: 'out', label: 'H1' },
    ],
  },
  {
    id: 'tpl-view-large',
    name: '观景窗（大玻璃）',
    type: 'view',
    allowedFamilies: ['mixed', 'fixed'],
    components: [
      { id: 'frame', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
      { id: 'glass-1', kind: 'fixedGlass', xRatio: 0.01, yRatio: 0.01, wRatio: 0.98, hRatio: 0.98, parentId: 'frame', windowType: 'fixed', label: 'V1' },
    ],
  },
  {
    id: 'tpl-combo-two-fixed',
    name: '组合窗（两固定）',
    type: 'custom',
    allowedFamilies: ['fixed', 'casement', 'mixed'],
    components: [
      { id: 'frame-a', kind: 'outerFrame', xRatio: 0, yRatio: 0, wRatio: 0.5, hRatio: 1 },
      { id: 'glass-a', kind: 'fixedGlass', xRatio: 0.01, yRatio: 0.01, wRatio: 0.48, hRatio: 0.98, parentId: 'frame-a', windowType: 'fixed', label: 'F1' },
      { id: 'frame-b', kind: 'outerFrame', xRatio: 0.5, yRatio: 0, wRatio: 0.5, hRatio: 1 },
      { id: 'glass-b', kind: 'fixedGlass', xRatio: 0.51, yRatio: 0.01, wRatio: 0.48, hRatio: 0.98, parentId: 'frame-b', windowType: 'fixed', label: 'F2' },
    ],
  },
];
