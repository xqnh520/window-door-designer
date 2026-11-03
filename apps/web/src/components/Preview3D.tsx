import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { focusedTreeFromAssembly, selectCurrentSeriesId, useStore } from '../store';
import { colorHex } from './studio/palette';
import { sampleOutline } from '../canvas/model';
import { arcChainOf, arcFromChord, insetPolygon, polygonArea, sashWidthOf } from '@wdd/core';
import { assemblyToShapes, assemblySize } from '../canvas/shapes3d';
import type { LegacyShape } from '../canvas/legacyShape';

type Pt2 = { x: number; y: number };

/**
 * 挤出用轮廓：有子区真实轮廓（异形框叶 / 弧梃切出的月牙边）时一律按它等距内缩，
 * 内缩退化就折半重试直至退回原轮廓（绝不回退成 bbox，否则又会露出直边）；无轮廓才按 bbox/形状算。
 */
function outlineOf(s: LegacyShape, inset: number): Pt2[] {
  const c = s.contour;
  if (!c || c.length < 3) return sampleOutline(s, inset);
  let off = inset;
  while (off > 0) {
    const pts = insetPolygon(c, off);
    if (pts.length >= 3 && Math.abs(polygonArea(pts)) > 1) return pts;
    off /= 2;
  }
  return c;
}

export function Preview3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const assembly = useStore((s) => s.assembly);
  const focusedUnitId = useStore((s) => s.focusedUnitId);
  const windowTree = useMemo(
    () => focusedTreeFromAssembly(assembly, focusedUnitId),
    [assembly, focusedUnitId],
  );
  const outerColor = useStore((s) => s.orderConfig.outerColor);
  const innerColor = useStore((s) => s.orderConfig.innerColor);
  const meshSizeConfig = useStore((s) => s.orderConfig.screenMeshSize);
  const meshColorConfig = useStore((s) => s.orderConfig.screenMeshColor);
  const beadStyle = useStore((s) => ((s.orderConfig as any).beadStyle as 'square' | 'sloped') ?? 'square'); // 目前仅 square（斜压线 sloped 为预留）
  const seriesId = useStore(selectCurrentSeriesId);
  const series = useStore((s) => s.library.series.find((x) => x.id === seriesId) ?? s.library.series[0]);

  // 3D 只消费 WindowAssembly 的单向投影；兼容图形不进入运行时 store。
  const effectiveShapes = useMemo<LegacyShape[]>(
    () => (assembly ? assemblyToShapes(assembly, series) : []),
    [assembly, series],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const outerHex = colorHex(outerColor);
    const innerHex = colorHex(innerColor);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    const multi = assembly && assembly.units.length > 1 ? assemblySize(assembly) : null;
    const drawW = Math.max(windowTree ? windowTree.openingW + 600 : 0, multi ? multi.w + 600 : 0, 3200);
    const drawH = Math.max(windowTree ? windowTree.openingH + 600 : 0, multi ? multi.h + 600 : 0, 2200);
    const S = Math.max(2.0, drawW / 1000, drawH / 1000);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 1000);
    camera.position.set(S * 1.6, S * 1.5, S * 2.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    const group = new THREE.Group();

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const mainLight = new THREE.DirectionalLight(0xfff4e6, 1.6);
    mainLight.position.set(S * 2, S * 3, S * 2);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 0.1;
    mainLight.shadow.camera.far = S * 8;
    mainLight.shadow.camera.left = -S * 3;
    mainLight.shadow.camera.right = S * 3;
    mainLight.shadow.camera.top = S * 3;
    mainLight.shadow.camera.bottom = -S * 3;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-S * 1.2, S * 1.4, S * 2.2);
    scene.add(fillLight);

    // ── 材质 ──
    const outerMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(outerHex),
      roughness: 0.3,
      metalness: 0.9,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    });
    const innerMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(innerHex),
      roughness: 0.3,
      metalness: 0.9,
      clearcoat: 0.4,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    });
    // 兼容：frameMat 用于「非面向」结构件（纱网框、玻璃压线等，颜色随室外面）
    const frameMat = outerMat;

    const beadMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(outerHex),
      roughness: 0.45,
      metalness: 0.4,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    });

    const grooveMat = new THREE.MeshStandardMaterial({
      color: 0x0d0d0d,
      roughness: 0.6,
      metalness: 0.3,
    });

    const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });

    const glassColor = new THREE.Color(outerHex).lerp(new THREE.Color('#e8f4ff'), 0.5);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: glassColor,
      metalness: 0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // ── 纱窗网纹（可配置：网孔大小 mm + 网线颜色）──
    const MESH_LINE_COLORS: Record<string, [number, number, number]> = {
      深灰: [105, 115, 125],
      黑色: [26, 28, 32],
      浅灰: [172, 178, 186],
      不锈钢: [152, 160, 170],
    };
    const meshSize = meshSizeConfig ?? 8;
    const meshRgb = MESH_LINE_COLORS[meshColorConfig] ?? MESH_LINE_COLORS['深灰'];
    const disposedTextures: THREE.Texture[] = [];

    /** 按纱窗尺寸生成网纹材质（1 个纹理 = 1 个网孔，repeat 铺满） */
    const makeScreenMat = (wMm: number, hMm: number): THREE.MeshStandardMaterial => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = 'rgba(226,229,232,1)';
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = `rgba(${meshRgb[0]},${meshRgb[1]},${meshRgb[2]},0.95)`;
      ctx.lineWidth = Math.max(2, 64 * 0.05);
      ctx.strokeRect(0.5, 0.5, 63, 63);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(wMm / meshSize)), Math.max(1, Math.round(hMm / meshSize)));
      disposedTextures.push(tex);
      return new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        opacity: 0.62,
        roughness: 0.78,
        metalness: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    };

    // ── 型材参数（mm）──
    const W = series.frameWidth;
    const D = W;
    /** 扇料面宽（mm）：树模式与 2D/BOM 同源（sashWidthOf），旧画布模式沿用框宽 */
    const sashW = windowTree ? sashWidthOf(windowTree) : W;
    const LIP_T = 4;
    const LIP_W = Math.max(5, D * 0.1);
    const BAND_R = 4.5;
    const CAP_T = Math.max(12, W * 0.2);
    const LINER_R = 7;
    const BODY_R = 8;
    const GROOVE = Math.max(6, D * 0.22);
    const GC = D * 0.35;
    const FACE_STEP = 2;
    const BEAD = 12;
    const BEAD_H = 4;

    const addOutline = (mesh: THREE.Mesh) => {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), lineMat);
      mesh.add(edges);
    };

    // ★ 拼角线：在轮廓拐角处画 45° 对角黑线（前后两面）
    const addMiterLines = (
      parent: THREE.Object3D,
      oPts: { x: number; y: number }[],
      iPts: { x: number; y: number }[],
      dep: number,
      m: number,
    ) => {
      const n = oPts.length;
      if (n < 3 || iPts.length < 3) return;

      const CORNER_ANGLE = 20 * (Math.PI / 180); // 20° 阈值
      const MIN_CORNER_DIST = 30; // 最小拐角间距(mm)，防止密集误判
      const positions: number[] = [];
      let lastCorner = { x: -1e9, y: -1e9 };

      for (let i = 0; i < n; i++) {
        const prev = oPts[(i - 1 + n) % n];
        const curr = oPts[i];
        const next = oPts[(i + 1) % n];

        const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 < 0.01 || len2 < 0.01) continue;

        const cross = (dx1 / len1) * (dy2 / len2) - (dy1 / len1) * (dx2 / len2);
        const dot = (dx1 / len1) * (dx2 / len2) + (dy1 / len1) * (dy2 / len2);
        const angle = Math.abs(Math.atan2(cross, dot));

        if (angle > CORNER_ANGLE) {
          // 最小距离过滤
          const dd = Math.hypot(curr.x - lastCorner.x, curr.y - lastCorner.y);
          if (dd < MIN_CORNER_DIST) continue;
          lastCorner = curr;

          // 找最近的内点
          let minDist = Infinity;
          let nearest = iPts[0];
          for (const ip of iPts) {
            const d = (ip.x - curr.x) ** 2 + (ip.y - curr.y) ** 2;
            if (d < minDist) { minDist = d; nearest = ip; }
          }

          // 前面 z=0
          positions.push(curr.x * m, -curr.y * m, 0);
          positions.push(nearest.x * m, -nearest.y * m, 0);
          // 后面 z=dep
          positions.push(curr.x * m, -curr.y * m, dep);
          positions.push(nearest.x * m, -nearest.y * m, dep);
        }
      }

      if (positions.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(geo, lineMat);
      parent.add(lines);
    };

    for (const s of effectiveShapes) {
      const m = 1 / 1000;
      const Dm = D * m;

      // 中梃（直线）：长轴默认沿窗平面 X（2D 中 muntin 的方向由「竖/横」决定，角度旋转对齐）
      if (s.type === 'line') {
        const p1 = s.p1 ?? { x: s.bbox.x, y: s.bbox.y };
        const p2 = s.p2 ?? { x: s.bbox.x + s.bbox.w, y: s.bbox.y + s.bbox.h };
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const baseLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || Math.max(s.bbox.w, s.bbox.h);
        const thickness = s.widthMm ?? (Math.min(s.bbox.w, s.bbox.h) || D * 0.6);
        // 端头嵌入外框（每端 +JAM），深度与框料齐平（D）→ 与外框拼接紧密无隙
        const JAM = 8;
        const lenW = (baseLen + 2 * JAM) * m;
        const thH = thickness * m;
        const halfD = Dm / 2;
        // 弧梃：沿弧链逐段摆小料（前后两层与直梃一致），段间留少量重叠避免接缝透光
        if (s.curve) {
          const arc = arcFromChord(p1, p2, s.curve.sagittaMm);
          const chain = arc ? arcChainOf(arc, arc.rMm, 24, 0) : null;
          if (chain && chain.length > 2) {
            const muntin = new THREE.Group();
            muntin.position.set(cx * m + (-drawW / 2) * m, -(cy * m) + (drawH / 2) * m, 0);
            for (let i = 0; i + 1 < chain.length; i++) {
              const a = chain[i];
              const b = chain[i + 1];
              const segLen = Math.hypot(b.x - a.x, b.y - a.y);
              if (segLen <= 0) continue;
              const geo = new THREE.BoxGeometry((segLen * 1.12 + 1) * m, thH, halfD);
              const mx = ((a.x + b.x) / 2 - cx) * m;
              const my = -((a.y + b.y) / 2 - cy) * m;
              const ang = -Math.atan2(b.y - a.y, b.x - a.x);
              const front = new THREE.Mesh(geo, frameMat);
              front.position.set(mx, my, halfD / 2);
              const back = new THREE.Mesh(geo, innerMat);
              back.position.set(mx, my, Dm + halfD / 2);
              for (const seg of [front, back]) {
                seg.rotation.z = ang;
                seg.castShadow = true;
                seg.receiveShadow = true;
                muntin.add(seg);
              }
            }
            group.add(muntin);
            continue;
          }
        }
        const muntin = new THREE.Group();
        const mFront = new THREE.Mesh(new THREE.BoxGeometry(lenW, thH, halfD), frameMat);
        mFront.position.z = halfD / 2;
        const mBack = new THREE.Mesh(new THREE.BoxGeometry(lenW, thH, halfD), innerMat);
        mBack.position.z = halfD + halfD / 2;
        for (const mm of [mFront, mBack]) {
          mm.castShadow = true;
          mm.receiveShadow = true;
          addOutline(mm);
          muntin.add(mm);
        }
        muntin.position.set(cx * m + (-drawW / 2) * m, -(cy * m) + (drawH / 2) * m, 0);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        muntin.rotation.z = -angle;
        group.add(muntin);
        continue;
      }

      const makeRing = (
        offO: number, offI: number, z0: number, dep: number,
        mat: THREE.Material, bevel = false, matBack?: THREE.Material,
      ): THREE.Object3D | null => {
        if (matBack && matBack !== mat && dep > 1e-6) {
          const half = dep / 2;
          const a = makeRing(offO, offI, z0, half, mat, bevel);
          const b = makeRing(offO, offI, z0 + half, half, matBack, bevel);
          if (!a && !b) return null;
          if (!a) return b;
          if (!b) return a;
          const grp = new THREE.Group();
          grp.add(a);
          grp.add(b);
          return grp;
        }
        let oPts: { x: number; y: number }[];
        let iPts: { x: number; y: number }[];
        if (s.contour && s.contour.length >= 3) {
          oPts = outlineOf(s, offO);
          iPts = outlineOf(s, offI);
        } else if (s.type === 'rect') {
          const b = s.bbox;
          oPts = [
            { x: b.x + offO, y: b.y + offO },
            { x: b.x + b.w - offO, y: b.y + offO },
            { x: b.x + b.w - offO, y: b.y + b.h - offO },
            { x: b.x + offO, y: b.y + b.h - offO },
          ];
          const iw = b.w - 2 * offI, ih = b.h - 2 * offI;
          if (iw <= 0 || ih <= 0) return null;
          iPts = [
            { x: b.x + offI, y: b.y + offI },
            { x: b.x + offI + iw, y: b.y + offI },
            { x: b.x + offI + iw, y: b.y + offI + ih },
            { x: b.x + offI, y: b.y + offI + ih },
          ];
        } else {
          oPts = sampleOutline(s, offO);
          iPts = sampleOutline(s, offI);
        }
        if (oPts.length < 3 || iPts.length < 3) return null;
        const shape = new THREE.Shape();
        oPts.forEach((p, i) => (i === 0 ? shape.moveTo(p.x * m, -p.y * m) : shape.lineTo(p.x * m, -p.y * m)));
        shape.closePath();
        const hole = new THREE.Path();
        iPts.forEach((p, i) => (i === 0 ? hole.moveTo(p.x * m, -p.y * m) : hole.lineTo(p.x * m, -p.y * m)));
        hole.closePath();
        shape.holes.push(hole);
        const geo = new THREE.ExtrudeGeometry(
          shape,
          bevel
            ? { depth: dep, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2 }
            : { depth: dep, bevelEnabled: false },
        );
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = z0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        addOutline(mesh);
        addMiterLines(mesh, oPts, iPts, dep, m);
        return mesh;
      };


      const parts: (THREE.Object3D | null)[] = [];
      // 树模式：外框本体渲染多层框料环；固定格仍"格子即板面"（不再内套框环）
      if (!windowTree || s.componentKind === 'outerFrame') {
        parts.push(
          makeRing(0, LIP_T, 0, LIP_W * m, frameMat, true, innerMat),
          makeRing(0, LIP_T, (D - LIP_W) * m, LIP_W * m, frameMat, true, innerMat),
          makeRing(BAND_R, CAP_T, 0, (GC - GROOVE / 2) * m, frameMat, true, innerMat),
          makeRing(BAND_R, CAP_T, (GC + GROOVE / 2) * m, (D - GC - GROOVE / 2) * m, frameMat, true, innerMat),
          makeRing(LINER_R, CAP_T + 1, (GC - GROOVE / 2 + 0.5) * m, (GROOVE - 1) * m, grooveMat),
          makeRing(BODY_R, W, FACE_STEP * m, Dm - 2 * FACE_STEP * m, frameMat, false, innerMat),
        );

        if (beadStyle === 'sloped') {
          parts.push(
            makeRing(W - BEAD, W + 4, -BEAD_H * m, (BEAD_H + FACE_STEP + 0.5) * m, beadMat, true),
            makeRing(W - BEAD, W + 4, (D - FACE_STEP - 0.5) * m, (BEAD_H + FACE_STEP + 0.5) * m, beadMat, true),
          );
        }
      } 

      // 树模式开启扇/纱扇：沿子区轮廓走一圈扇料（前=外面色 / 后=内色），2mm 企口缝避免与框料、中梃共面
      const isSashLeaf =
        !!windowTree &&
        (s.componentKind === 'casementSash' ||
          s.componentKind === 'slidingSash' ||
          s.componentKind === 'topHungSash' ||
          s.componentKind === 'screen');
      let sashInset = 0;
      if (isSashLeaf) {
        const so = outlineOf(s, 2);
        const si = outlineOf(s, sashW);
        if (so !== si && Math.abs(polygonArea(si)) < Math.abs(polygonArea(so)) * 0.98) {
          parts.push(makeRing(2, sashW, 0, Dm, frameMat, false, innerMat));
          sashInset = sashW;
        }
      }

      // 玻璃/纱窗（树模式：固定格铺满格子与框料/中梃共面贴合，开启扇按扇料内缩；旧画布模式：按框料搭接内缩）
      const iPts = outlineOf(s, windowTree ? sashInset : W);
      if (iPts.length >= 3 && s.componentKind !== 'outerFrame') {
        const glassShape = new THREE.Shape();
        iPts.forEach((p, i) => (i === 0 ? glassShape.moveTo(p.x * m, -p.y * m) : glassShape.lineTo(p.x * m, -p.y * m)));
        glassShape.closePath();
        const glassMesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(glassShape, { depth: 0.012, bevelEnabled: false }),
          s.componentKind === 'screen' ? makeScreenMat(s.bbox.w, s.bbox.h) : glassMat,
        );
        glassMesh.position.z = Dm / 2 - 0.006;
        addOutline(glassMesh);
        parts.push(glassMesh);
      }

      // ✅ 新代码：点已是全局坐标，只需整体平移到画布中心一次
parts.forEach((part) => {
  if (!part) return;
  part.position.x = (-drawW / 2) * m;
  part.position.y = (drawH / 2) * m;
  group.add(part);
});
    }

    // ── 落地对齐 ──
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
      group.position.y -= box.min.y + 0.001;
      const size = box.getSize(new THREE.Vector3());
      controls.target.set(0, size.y * 0.5, 0);
    } else {
      controls.target.set(0, S * 0.5, 0);
    }
    camera.lookAt(controls.target);

    // ── 瓷砖地面 ──
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = 512;
    tileCanvas.height = 512;
    const ctx = tileCanvas.getContext('2d')!;
    ctx.fillStyle = '#c9bb9c';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${140 + Math.random() * 60}, ${130 + Math.random() * 50}, ${100 + Math.random() * 40}, ${0.08 + Math.random() * 0.1})`;
      ctx.lineWidth = Math.random() * 2 + 0.5;
      ctx.beginPath();
      let x = Math.random() * 512;
      let y = Math.random() * 512;
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (Math.random() - 0.5) * 120;
        y += (Math.random() - 0.5) * 120;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 512; i += 256) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    const tileTexture = new THREE.CanvasTexture(tileCanvas);
    tileTexture.wrapS = THREE.RepeatWrapping;
    tileTexture.wrapT = THREE.RepeatWrapping;
    tileTexture.repeat.set(8, 8);
    tileTexture.colorSpace = THREE.SRGBColorSpace;

    const groundGeo = new THREE.PlaneGeometry(S * 10, S * 10);
    const groundMat = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.35, metalness: 0.05 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) {
          const obj = o as THREE.Mesh;
          obj.geometry.dispose();
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((mm) => mm.dispose());
        }
      });
      tileTexture.dispose();
      disposedTextures.forEach((t) => t.dispose());
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [assembly, effectiveShapes, windowTree, series, outerColor, innerColor, beadStyle, meshSizeConfig, meshColorConfig]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 480 }} />;
}
