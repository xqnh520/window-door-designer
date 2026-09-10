import type {
  MaterialLibrary,
  Profile,
  SeriesConstraints,
  SeriesCutRow,
  SeriesSpec,
} from './material.js';

/** 平开系列工艺约束样本（开启扇尺寸上限、玻璃面积上限按常见平开工艺取值） */
const casementConstraints: SeriesConstraints = {
  minSashW: 300,
  minSashH: 400,
  maxSashW: 900,
  maxSashH: 2000,
  minGlassW: 100,
  minGlassH: 100,
  maxGlassAreaM2: 3,
  minComponentSize: 50,
};

/** 推拉系列工艺约束样本（扇宽可更大，玻璃面积上限略高） */
const slidingConstraints: SeriesConstraints = {
  minSashW: 350,
  minSashH: 400,
  maxSashW: 1400,
  maxSashH: 2400,
  minGlassW: 100,
  minGlassH: 100,
  maxGlassAreaM2: 4.5,
  minComponentSize: 50,
};

/**
 * 平开系共享出料行（60/70/75/110 系复用）。
 * 等价性说明：旧 profileFormulas frame={length:'frameOuterW',count:'2'} 仅覆盖横料，
 * 竖料走内置回退 frameOuterH —— 故横/竖拆两行、竖行引 cc-1295(=frameOuterH)；扇料旧
 * count:'2'（每扇）再乘 sashCount，等价 panel 行 side 展开×count='sashCount'（上下+左右共 4×sashCount 根，
 * 引擎不再外乘）。压线行把内置周长硬编码搬进行表（unit:米，整圈只记一次不乘边数）。
 */
const CASEMENT_CUTS: SeriesCutRow[] = [
  { id: 'frame-h', label: '横框', role: 'frame', side: ['up', 'down'], length: 'cc-1294', count: '1', scope: 'window' },
  { id: 'frame-v', label: '竖框', role: 'frame', side: ['left', 'right'], length: 'cc-1295', count: '1', scope: 'window' },
  { id: 'sash-h', label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: 'sashW', count: 'sashCount', scope: 'panel' },
  { id: 'sash-v', label: '扇料(竖)', role: 'sash', side: ['left', 'right'], length: 'sashH', count: 'sashCount', scope: 'panel' },
  { id: 'bead', label: '压线', role: 'bead', side: ['up', 'down', 'left', 'right'], length: 'glassW*2+glassH*2', count: '1', unit: '米', scope: 'panel' },
];

/** 推拉系共享出料行（108/120 系复用）：上滑/下滑各一根横料，边框为竖料 count 2 */
const SLIDING_CUTS: SeriesCutRow[] = [
  { id: 'track', label: '上滑', role: 'track', side: ['up'], length: 'cc-1294', count: '1', scope: 'window' },
  { id: 'sill', label: '下滑', role: 'sill', side: ['down'], length: 'cc-1294', count: '1', scope: 'window' },
  { id: 'frame-v', label: '边框', role: 'frame', side: ['left', 'right'], length: 'cc-1295', count: '1', scope: 'window' },
  { id: 'sash-h', label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: 'sashW', count: 'sashCount', scope: 'panel' },
  { id: 'sash-v', label: '扇料(竖)', role: 'sash', side: ['left', 'right'], length: 'sashH', count: 'sashCount', scope: 'panel' },
  { id: 'bead', label: '压线', role: 'bead', side: ['up', 'down', 'left', 'right'], length: 'glassW*2+glassH*2', count: '1', unit: '米', scope: 'panel' },
];

/** 公式库：出料行 length 引用 `cc-N`，N 为公式库键（数字） */
const COMMON_FORMULA_BANK: Record<string, string> = {
  '1294': 'frameOuterW',
  '1295': 'frameOuterH',
};

/** 110 系 showSetting 使用 windoorcraft 实测值（docs/WINDOORCRAFT_PROFILE_SERIES_SPEC.md §5.1）；
 *  其余键（upSash/screen/subFrame/doorBeam/…）为 110 系实测，其他系按断面比例假设，待逐系实测 */
const EXT_SETTING = {
  upSash: 60,
  downSash: 60,
  screen: 60,
  subFrame: 24,
  doorBeam: 100,
  connector: 60,
  interlock: 60,
  cornerJoiner: 100,
  frameMullion: 40,
  shadeMullion: 35,
  antiTheft: 24,
  kfcWaist: 200,
  shadeSash: 60,
  sashHolder: 100,
  sashMullion: 60,
  innerFrame: 45,
  reinforcedFrameMullion: 90,
};

export const series60: SeriesSpec = {
  id: 'series-60',
  name: '60系断桥平开',
  windowFamily: 'casement',
  installGap: 20,
  frameWidth: 60,
  sashWidth: 45,
  overlap: 8,
  glassGap: 5,
  beadWidth: 15,
  cornerType: '45',
  aluminumPrice: 26.5,
  constraints: casementConstraints,
  profileRoles: {
    frame: 'p-frame-60',
    sash: 'p-sash-60',
    mullion: 'p-mullion-60',
    bead: 'p-bead-60',
  },
  formulaBank: COMMON_FORMULA_BANK,
  showSetting: { frame: 60, sash: 45, bead: 15, glassGap: 5, overlap: 8, ...EXT_SETTING },
  cuts: CASEMENT_CUTS,
};

export const series70: SeriesSpec = {
  id: 'series-70',
  name: '70系断桥平开',
  windowFamily: 'casement',
  installGap: 20,
  frameWidth: 70,
  sashWidth: 52,
  overlap: 8,
  glassGap: 5,
  beadWidth: 15,
  cornerType: '45',
  aluminumPrice: 31,
  constraints: casementConstraints,
  profileRoles: {
    frame: 'p-frame-70',
    sash: 'p-sash-70',
    mullion: 'p-mullion-70',
    bead: 'p-bead-70',
  },
  formulaBank: COMMON_FORMULA_BANK,
  showSetting: { frame: 70, sash: 52, bead: 15, glassGap: 5, overlap: 8, ...EXT_SETTING },
  cuts: CASEMENT_CUTS,
};

export const series75: SeriesSpec = {
  id: 'series-75',
  name: '75系系统平开',
  windowFamily: 'casement',
  installGap: 20,
  frameWidth: 75,
  sashWidth: 56,
  overlap: 8,
  glassGap: 5,
  beadWidth: 15,
  cornerType: '45',
  aluminumPrice: 34,
  constraints: casementConstraints,
  profileRoles: {
    frame: 'p-frame-75',
    sash: 'p-sash-75',
    mullion: 'p-mullion-75',
    bead: 'p-bead-75',
  },
  formulaBank: COMMON_FORMULA_BANK,
  showSetting: { frame: 75, sash: 56, bead: 15, glassGap: 5, overlap: 8, ...EXT_SETTING },
  cuts: CASEMENT_CUTS,
};

export const series110: SeriesSpec = {
  id: 'series-110',
  name: '110系系统窗',
  windowFamily: 'mixed',
  installGap: 20,
  frameWidth: 110,
  sashWidth: 62,
  overlap: 10,
  glassGap: 6,
  beadWidth: 18,
  cornerType: '45',
  aluminumPrice: 39,
  constraints: casementConstraints,
  profileRoles: {
    frame: 'p-frame-110',
    sash: 'p-sash-110',
    mullion: 'p-mullion-110',
    bead: 'p-bead-110',
    viewEnhance: 'p-frame-110', // 观景窗加强角码复用框料
  },
  formulaBank: COMMON_FORMULA_BANK,
  // 料宽为 windoorcraft 110平开系列实测值（docs/WINDOORCRAFT_PROFILE_SERIES_SPEC.md §5.1）
  showSetting: { frame: 40, sash: 60, bead: 22, glassGap: 6, overlap: 10, ...EXT_SETTING },
  cuts: [
    ...CASEMENT_CUTS,
    { id: 'view-enhance', label: '加强角码(观景)', role: 'viewEnhance', side: [], length: '80', count: 'frameCount*4', scope: 'window' },
  ],
};

export const series108: SeriesSpec = {
  id: 'series-108',
  name: '108系断桥推拉',
  windowFamily: 'sliding',
  installGap: 20,
  frameWidth: 108,
  sashWidth: 62,
  overlap: 12,
  glassGap: 5,
  beadWidth: 15,
  cornerType: '45',
  aluminumPrice: 35,
  constraints: slidingConstraints,
  profileRoles: {
    frame: 'p-frame-108',
    sash: 'p-sash-108',
    mullion: 'p-mullion-108',
    track: 'p-track-108',
    sill: 'p-sill-108',
    bead: 'p-bead-108',
  },
  formulaBank: COMMON_FORMULA_BANK,
  showSetting: { frame: 108, sash: 62, bead: 15, glassGap: 5, overlap: 12, ...EXT_SETTING },
  cuts: SLIDING_CUTS,
};

export const series120: SeriesSpec = {
  id: 'series-120',
  name: '120系系统推拉',
  windowFamily: 'sliding',
  installGap: 20,
  frameWidth: 120,
  sashWidth: 68,
  overlap: 14,
  glassGap: 6,
  beadWidth: 18,
  cornerType: '45',
  aluminumPrice: 42,
  constraints: slidingConstraints,
  profileRoles: {
    frame: 'p-frame-120',
    sash: 'p-sash-120',
    mullion: 'p-mullion-120',
    track: 'p-track-120',
    sill: 'p-sill-120',
    bead: 'p-bead-120',
  },
  formulaBank: COMMON_FORMULA_BANK,
  showSetting: { frame: 120, sash: 68, bead: 18, glassGap: 6, overlap: 14, ...EXT_SETTING },
  cuts: SLIDING_CUTS,
};

export const sampleLibrary: MaterialLibrary = {
  series: [series60, series70, series75, series110, series108, series120],
  profiles: [
    profile('p-frame-60', 'series-60', 'LK60-01', '框料60', 'frame', 60, 42),
    profile('p-sash-60', 'series-60', 'LK60-02', '扇料60', 'sash', 45, 36),
    profile('p-mullion-60', 'series-60', 'LK60-03', '中梃60', 'mullion', 40, 30),
    profile('p-bead-60', 'series-60', 'LK60-04', '压线60', 'bead', 15, 9),
    profile('p-frame-70', 'series-70', 'LK70-01', '框料70', 'frame', 70, 49),
    profile('p-sash-70', 'series-70', 'LK70-02', '扇料70', 'sash', 52, 41),
    profile('p-mullion-70', 'series-70', 'LK70-03', '中梃70', 'mullion', 50, 36),
    profile('p-bead-70', 'series-70', 'LK70-04', '压线70', 'bead', 15, 9),
    profile('p-frame-75', 'series-75', 'LK75-01', '框料75', 'frame', 75, 53),
    profile('p-sash-75', 'series-75', 'LK75-02', '扇料75', 'sash', 56, 46),
    profile('p-mullion-75', 'series-75', 'LK75-03', '中梃75', 'mullion', 55, 40),
    profile('p-bead-75', 'series-75', 'LK75-04', '压线75', 'bead', 18, 11),
    profile('p-frame-110', 'series-110', 'LK110-01', '框料110', 'frame', 110, 62),
    profile('p-sash-110', 'series-110', 'LK110-02', '扇料110', 'sash', 62, 49),
    profile('p-mullion-110', 'series-110', 'LK110-03', '中梃110', 'mullion', 80, 48),
    profile('p-bead-110', 'series-110', 'LK110-04', '压线110', 'bead', 18, 11),
    profile('p-frame-108', 'series-108', 'LK108-01', '框料108', 'frame', 108, 58),
    profile('p-sash-108', 'series-108', 'LK108-02', '扇料108', 'sash', 62, 44),
    profile('p-mullion-108', 'series-108', 'LK108-03', '中梃108', 'mullion', 80, 45),
    profile('p-track-108', 'series-108', 'LK108-04', '上滑108', 'track', 80, 52),
    profile('p-sill-108', 'series-108', 'LK108-05', '下滑108', 'sill', 96, 55),
    profile('p-bead-108', 'series-108', 'LK108-06', '压线108', 'bead', 15, 9),
    profile('p-frame-120', 'series-120', 'LK120-01', '框料120', 'frame', 120, 66),
    profile('p-sash-120', 'series-120', 'LK120-02', '扇料120', 'sash', 68, 52),
    profile('p-mullion-120', 'series-120', 'LK120-03', '中梃120', 'mullion', 90, 52),
    profile('p-track-120', 'series-120', 'LK120-04', '上滑120', 'track', 100, 62),
    profile('p-sill-120', 'series-120', 'LK120-05', '下滑120', 'sill', 110, 66),
    profile('p-bead-120', 'series-120', 'LK120-06', '压线120', 'bead', 18, 11),
  ],
  glass: [
    { id: 'g-5mm', name: '5mm 单片玻璃', thickness: 5, layers: 1, unitPrice: 95 },
    { id: 'g-5-12a-5', name: '5+12A+5 中空玻璃', thickness: 22, layers: 2, unitPrice: 168 },
    { id: 'g-6-12a-6', name: '6+12A+6 中空玻璃', thickness: 24, layers: 2, unitPrice: 185 },
    { id: 'g-5-9a-5low-e', name: '5+9A+5 Low-E 中空玻璃', thickness: 19, layers: 2, unitPrice: 210 },
  ],
  hardware: [
    { id: 'hw-hinge', code: 'HW-HG01', name: '平开合页', unit: '只', unitPrice: 28, windowTypes: ['casement', 'topHinged', 'casementUp', 'tiltSlide'] },
    { id: 'hw-transmission', code: 'HW-TR01', name: '传动器', unit: '支', unitPrice: 45, windowTypes: ['casement', 'casementUp', 'tiltSlide'] },
    { id: 'hw-handle', code: 'HW-HD01', name: '执手', unit: '支', unitPrice: 68, windowTypes: ['casement', 'topHinged', 'casementUp', 'tiltSlide'] },
    { id: 'hw-lockpoint', code: 'HW-LP01', name: '锁点', unit: '个', unitPrice: 6.5, windowTypes: ['casement', 'sliding', 'casementUp', 'tiltSlide'] },
    { id: 'hw-slider', code: 'HW-SL01', name: '推拉滑轮', unit: '只', unitPrice: 15, windowTypes: ['sliding', 'tiltSlide'] },
    { id: 'hw-slidinglock', code: 'HW-SL02', name: '推拉锁', unit: '把', unitPrice: 35, windowTypes: ['sliding'] },
    { id: 'hw-tophinge', code: 'HW-TH01', name: '上悬滑撑', unit: '只', unitPrice: 52, windowTypes: ['topHinged'] },
    { id: 'hw-turn-tilt', code: 'HW-TT01', name: '内开内倒五金', unit: '套', unitPrice: 260, windowTypes: ['casementUp', 'tiltSlide'] },
  ],
  accessory: [
    { id: 'acc-seal', code: 'AC-SE01', name: '中性密封胶条(EPDM)', unit: '米', unitPrice: 3.5, perM2: 3.2 },
    { id: 'acc-mohair', code: 'AC-MH01', name: '毛条', unit: '米', unitPrice: 1.8, perM2: 1.6 },
    { id: 'acc-pad', code: 'AC-PD01', name: '玻璃垫块', unit: '包', unitPrice: 12, perM2: 0.25 },
    { id: 'acc-screw', code: 'AC-SC01', name: '固定螺丝(304)', unit: '盒', unitPrice: 28, perM2: 0.4 },
  ],
};

function profile(
  id: string,
  seriesId: string,
  code: string,
  name: string,
  category: Profile['category'],
  sectionWidth: number,
  unitPrice: number,
): Profile {
  return { id, seriesId, code, name, category, sectionWidth, unitPrice, color: '香槟' };
}
