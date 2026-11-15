import * as THREE from "three";
import type { Avatar, Role, RoomPreview, RoomSeatView } from "../../shared/protocol";
import {
  buildChairSpots,
  buildColliders,
  CHAIR_SEAT_Y,
  type ChairSpot,
  type Collider,
  cameraView,
  chairNearPoint,
  distance,
  ENTRY,
  isNearSeat,
  nearestEmptyChair,
  type Point,
  ROOM,
  resolveMovement,
  seatCenter,
  seatStand,
  TABLE_RADIUS,
  TABLE_TOP_Y,
} from "./layout";
import {
  createDarkOakTexture,
  createFloorTexture,
  createNightTexture,
  createOakTexture,
  createRugTexture,
  createScreenTexture,
  createTableTexture,
  createWallTexture,
} from "./textures";

export interface LocalProfile {
  name: string;
  avatar: Avatar;
}

export interface RoomWorldCallbacks {
  onNearSeat: (seat: number | null) => void;
  onSitRequest: (seat: number) => void;
  onSeatSelect: (seat: RoomSeatView) => void;
  onUnavailable: (reason: string) => void;
}

export interface LobbyOptions {
  /** 本机玩家 id；大厅里用它跳过“自己”的座位头像 */
  localId: string;
  /** 本地位置同步；约 10Hz */
  onMove: (x: number, z: number, facing: number) => void;
}

export interface RoomWorldOptions {
  mode?: "join" | "lobby";
  lobby?: LobbyOptions;
}

export interface LobbyMotion {
  x: number;
  z: number;
  facing: number;
}

export interface RoomWorld {
  resize: () => void;
  setPreview: (preview: RoomPreview) => void;
  setProfile: (profile: LocalProfile) => void;
  setDisabled: (disabled: boolean) => void;
  setJoystick: (x: number, y: number) => void;
  setLobbyMotion: (motion: ReadonlyMap<string, LobbyMotion>) => void;
  sit: (seat?: number) => void;
  standUp: () => void;
  dispose: () => void;
}

const RENDER_HEIGHT = 320;
const LOBBY_RENDER_HEIGHT = 240;
const WALK_SPEED = 3.2;
const SIT_SECONDS = 0.35;
const STAND_SECONDS = 0.25;
const NEAR_DISTANCE = 0.74;

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

interface AvatarLabel {
  name: string;
  avatarText: string;
  color: string;
  offline: boolean;
  kind: "player" | "host" | "me";
}

interface AvatarHandle {
  group: THREE.Group;
  shirt: THREE.MeshLambertMaterial;
  label: AvatarLabel;
  legL?: THREE.Mesh;
  legR?: THREE.Mesh;
  armL?: THREE.Mesh;
  armR?: THREE.Mesh;
}

interface SitState {
  seat: number;
  mode: "sit" | "stand";
  elapsed: number;
  from: Point;
  to: Point;
  fromY: number;
  toY: number;
  requested: boolean;
}

interface LobbyPair {
  id: string;
  role: Role;
  ready: boolean;
  spot: ChairSpot | null;
  standing: AvatarHandle;
  seated: AvatarHandle | null;
  x: number;
  z: number;
  facing: number;
  isHost: boolean;
  seatedNow: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerpAngle(from: number, to: number, t: number): number {
  const delta = normalizeAngle(to - from);
  return normalizeAngle(from + delta * t);
}

export function createRoomWorld(
  canvas: HTMLCanvasElement,
  labelCanvas: HTMLCanvasElement,
  initialPreview: RoomPreview,
  profile: LocalProfile,
  callbacks: RoomWorldCallbacks,
  options: RoomWorldOptions = {},
): RoomWorld {
  const isLobby = options.mode === "lobby" && options.lobby !== undefined;
  const lobbyOptions = isLobby ? options.lobby : undefined;
  const renderHeight = isLobby ? LOBBY_RENDER_HEIGHT : RENDER_HEIGHT;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f14);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.5, 80);
  camera.position.set(18, 16, 18);
  camera.lookAt(0, 1.0, 0);

  const labelCtx = labelCanvas.getContext("2d");
  let labelScale = 1;
  const labelProjection = new THREE.Vector3();
  let labelWidth = 1;
  let labelHeight = 1;

  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const track = <T extends THREE.Texture>(texture: T): T => {
    textures.add(texture);
    return texture;
  };
  const trackGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };

  const floorTexture = track(createFloorTexture());
  const oakTexture = track(createOakTexture());
  const tableTexture = track(createTableTexture());
  const darkOakTexture = track(createDarkOakTexture());
  const wallTexture = track(createWallTexture());
  const rugTexture = track(createRugTexture());
  const nightTexture = track(createNightTexture());

  const floorMaterial = new THREE.MeshLambertMaterial({ map: floorTexture });
  const oakMaterial = new THREE.MeshLambertMaterial({ map: oakTexture });
  const tableMaterial = new THREE.MeshLambertMaterial({ map: tableTexture });
  const darkOakMaterial = new THREE.MeshLambertMaterial({ map: darkOakTexture });
  const wallMaterial = new THREE.MeshLambertMaterial({ map: wallTexture });
  const rugMaterial = new THREE.MeshLambertMaterial({ map: rugTexture });
  const nightMaterial = new THREE.MeshBasicMaterial({ map: nightTexture });
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const skinMaterial = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const hairMaterial = new THREE.MeshLambertMaterial({ color: 0x4a3527 });
  const pantsMaterial = new THREE.MeshLambertMaterial({ color: 0x3b4a63 });
  const offlineSkinMaterial = new THREE.MeshLambertMaterial({ color: 0x8d99a6 });
  const offlineHairMaterial = new THREE.MeshLambertMaterial({ color: 0x5b6673 });
  const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0x1b2430 });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  for (const material of [
    floorMaterial,
    oakMaterial,
    tableMaterial,
    darkOakMaterial,
    wallMaterial,
    rugMaterial,
    nightMaterial,
    shadowMaterial,
    skinMaterial,
    hairMaterial,
    pantsMaterial,
    offlineSkinMaterial,
    offlineHairMaterial,
    eyeMaterial,
    flameMaterial,
  ]) {
    materials.add(material);
  }

  const unitBox = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
  const circleGeometry = trackGeometry(new THREE.CircleGeometry(1, 20));
  const ringGeometry = trackGeometry(new THREE.RingGeometry(0.33, 0.44, 20));
  const planeGeometry = trackGeometry(new THREE.PlaneGeometry(1, 1));

  function block(
    parent: THREE.Object3D,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  function addShadow(
    parent: THREE.Object3D,
    x: number,
    z: number,
    radius: number,
    y = 0.012,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(circleGeometry, shadowMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(radius, radius, 1);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // ---------- 灯光 ----------
  scene.add(new THREE.HemisphereLight(0xfff1d0, 0x2a2018, 1.15));
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.5);
  sun.position.set(6, 11, 7);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fc7ff, 0.45);
  fill.position.set(-7, 6, -2);
  scene.add(fill);

  // ---------- 房间 ----------
  const room = new THREE.Group();
  scene.add(room);

  const floor = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(10.8, 8.8)), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);

  const rug = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(4.8, 3.4)), rugMaterial);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.014, 0);
  room.add(rug);

  // 背墙与左墙（近侧切开，避免挡镜头）
  block(room, 10.8, 3.4, 0.3, wallMaterial, 0, 1.7, -4.55);
  block(room, 0.3, 3.4, 8.8, wallMaterial, -5.55, 1.7, 0);
  block(room, 10.8, 0.16, 0.42, darkOakMaterial, 0, 0.08, -4.4);
  block(room, 0.42, 0.16, 8.8, darkOakMaterial, -5.4, 0.08, 0);
  block(room, 10.8, 0.18, 0.36, darkOakMaterial, 0, 3.32, -4.4);
  block(room, 0.36, 0.18, 8.8, darkOakMaterial, -5.4, 3.32, 0);

  // 后墙木梁
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
    block(room, 0.22, 3.3, 0.12, darkOakMaterial, x, 1.65, -4.38);
  }

  // 窗
  const windowFrame = new THREE.Group();
  windowFrame.position.set(0.9, 2.12, -4.37);
  room.add(windowFrame);
  const windowPlane = new THREE.Mesh(
    trackGeometry(new THREE.PlaneGeometry(2.5, 1.5)),
    nightMaterial,
  );
  windowFrame.add(windowPlane);
  block(windowFrame, 2.7, 0.14, 0.12, darkOakMaterial, 0, 0.82, 0.02);
  block(windowFrame, 2.7, 0.14, 0.12, darkOakMaterial, 0, -0.82, 0.02);
  block(windowFrame, 0.14, 1.7, 0.12, darkOakMaterial, -1.27, 0, 0.02);
  block(windowFrame, 0.14, 1.7, 0.12, darkOakMaterial, 1.27, 0, 0.02);
  block(windowFrame, 0.06, 1.5, 0.06, darkOakMaterial, 0, 0, 0.03);
  block(windowFrame, 2.5, 0.06, 0.06, darkOakMaterial, 0, 0, 0.03);

  // 左墙大屏
  const screenGroup = new THREE.Group();
  screenGroup.position.set(-5.36, 1.9, -1.0);
  room.add(screenGroup);
  block(screenGroup, 0.16, 1.75, 2.75, darkOakMaterial, -0.06, 0, 0);
  const screenTexture = track(createScreenTexture(initialPreview.code));
  const screenMaterial = new THREE.MeshBasicMaterial({ map: screenTexture });
  materials.add(screenMaterial);
  const screenPlane = new THREE.Mesh(planeGeometry, screenMaterial);
  screenPlane.rotation.y = Math.PI / 2;
  screenPlane.scale.set(2.45, 1.45, 1);
  screenPlane.position.set(0.02, 0, 0);
  screenGroup.add(screenPlane);
  block(screenGroup, 0.3, 0.5, 2.2, darkOakMaterial, -0.02, -1.08, 0);
  block(screenGroup, 0.42, 0.16, 0.42, darkOakMaterial, -0.02, -0.88, 0.9);

  // 窗下长凳 / 书架
  block(room, 2.4, 0.5, 0.65, darkOakMaterial, 3.7, 0.25, -3.95);
  block(room, 2.2, 1.9, 0.35, darkOakMaterial, -3.5, 0.95, -4.15);
  const bookColors = [0x8b3a3a, 0x3f6b5c, 0xc9a063, 0x4a5a8a, 0x7b5735];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const mat = new THREE.MeshLambertMaterial({
        color: bookColors[(row * 4 + col) % bookColors.length],
      });
      materials.add(mat);
      block(room, 0.34, 0.46, 0.22, mat, -4.25 + col * 0.5, 0.5 + row * 0.55, -3.93);
    }
  }

  // 绿植
  const plant = new THREE.Group();
  plant.position.set(-4.8, 0, 3.45);
  room.add(plant);
  block(plant, 0.55, 0.5, 0.55, darkOakMaterial, 0, 0.25, 0);
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x3f7a52 });
  materials.add(leafMaterial);
  block(plant, 0.34, 0.8, 0.34, leafMaterial, 0, 0.85, 0);
  block(plant, 0.7, 0.34, 0.34, leafMaterial, 0, 1.12, 0.05);
  block(plant, 0.34, 0.34, 0.7, leafMaterial, -0.05, 1.26, 0);

  // 入口垫
  const matMaterial = new THREE.MeshLambertMaterial({ color: 0x6b4b32 });
  materials.add(matMaterial);
  const entryMat = new THREE.Mesh(planeGeometry, matMaterial);
  entryMat.rotation.x = -Math.PI / 2;
  entryMat.position.set(0, 0.02, 3.85);
  entryMat.scale.set(1.8, 0.9, 1);
  room.add(entryMat);

  // ---------- 圆桌 ----------
  const table = new THREE.Group();
  room.add(table);
  const tableTop = new THREE.Mesh(
    trackGeometry(new THREE.CylinderGeometry(2.05, 2.05, 0.3, 16)),
    tableMaterial,
  );
  tableTop.position.y = TABLE_TOP_Y;
  table.add(tableTop);
  const tableRim = new THREE.Mesh(
    trackGeometry(new THREE.CylinderGeometry(2.12, 2.12, 0.14, 16)),
    darkOakMaterial,
  );
  tableRim.position.y = TABLE_TOP_Y - 0.19;
  table.add(tableRim);
  for (let index = 0; index < 4; index++) {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    block(
      table,
      0.34,
      0.82,
      0.34,
      darkOakMaterial,
      Math.cos(angle) * 1.32,
      0.41,
      Math.sin(angle) * 1.32,
    );
  }
  addShadow(table, 0, 0, 2.35, 0.03);

  // 桌上的蜡烛和杯子
  const candleMaterial = new THREE.MeshLambertMaterial({ color: 0xe9dcc0 });
  materials.add(candleMaterial);
  const candle = new THREE.Mesh(
    trackGeometry(new THREE.CylinderGeometry(0.08, 0.09, 0.24, 8)),
    candleMaterial,
  );
  candle.position.set(0.55, TABLE_TOP_Y + 0.27, 0.25);
  table.add(candle);
  const flame = block(table, 0.1, 0.16, 0.1, flameMaterial, 0.55, TABLE_TOP_Y + 0.46, 0.25);
  flame.rotation.z = 0.18;
  const candleLight = new THREE.PointLight(0xffc978, 3.4, 4.5, 2);
  candleLight.position.set(0.55, TABLE_TOP_Y + 0.62, 0.25);
  table.add(candleLight);

  const mugMaterial = new THREE.MeshLambertMaterial({ color: 0x4a5a8a });
  materials.add(mugMaterial);
  const mug = new THREE.Mesh(
    trackGeometry(new THREE.CylinderGeometry(0.12, 0.1, 0.2, 8)),
    mugMaterial,
  );
  mug.position.set(-0.7, TABLE_TOP_Y + 0.25, 0.45);
  table.add(mug);
  block(table, 0.1, 0.1, 0.05, mugMaterial, -0.54, TABLE_TOP_Y + 0.28, 0.45);

  // ---------- 椅子 ----------
  let chairGroup: THREE.Group | null = null;
  const highlights = new Map<number, THREE.Mesh>();
  let chairSpots: ChairSpot[] = [];
  let colliders: Collider[] = [];

  function disposeChairGroup(): void {
    if (!chairGroup) return;
    chairGroup.removeFromParent();
    for (const mesh of highlights.values()) {
      (mesh.material as THREE.Material).dispose();
    }
    highlights.clear();
    chairGroup = null;
  }

  function buildChairs(): void {
    disposeChairGroup();
    const group = new THREE.Group();
    chairGroup = group;
    room.add(group);
    for (const spot of chairSpots) {
      const chair = new THREE.Group();
      chair.position.set(spot.x, 0, spot.z);
      chair.rotation.y = Math.PI / 2 - spot.angle;
      block(chair, 0.64, 0.12, 0.56, oakMaterial, 0, CHAIR_SEAT_Y, 0);
      block(chair, 0.64, 0.72, 0.12, oakMaterial, 0, CHAIR_SEAT_Y + 0.42, 0.26);
      block(chair, 0.5, 0.04, 0.42, darkOakMaterial, 0, CHAIR_SEAT_Y + 0.08, 0);
      for (const x of [-0.24, 0.24]) {
        for (const z of [-0.19, 0.19]) {
          block(
            chair,
            0.1,
            CHAIR_SEAT_Y - 0.06,
            0.1,
            darkOakMaterial,
            x,
            (CHAIR_SEAT_Y - 0.06) / 2,
            z,
          );
        }
      }
      block(chair, 0.7, 0.08, 0.08, darkOakMaterial, 0, CHAIR_SEAT_Y + 0.82, 0.26);
      group.add(chair);
      addShadow(group, spot.x, spot.z, 0.42);

      const highlight = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x3ee08f,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      highlight.rotation.x = -Math.PI / 2;
      highlight.position.set(spot.x, 0.02, spot.z);
      group.add(highlight);
      highlights.set(spot.seat, highlight);
    }
  }

  // ---------- 小人 ----------
  function createAvatar(
    who: LocalProfile,
    mode: "stand" | "sit",
    kind: "player" | "host" | "me",
    offline = false,
  ): AvatarHandle {
    const group = new THREE.Group();
    const seated = mode === "sit";
    const shirt = new THREE.MeshLambertMaterial({
      color: offline ? 0x5b6673 : who.avatar.color,
    });
    materials.add(shirt);

    if (seated) {
      block(group, 0.52, 0.56, 0.3, shirt, 0, 0.36, 0);
      block(group, 0.18, 0.24, 0.5, pantsMaterial, -0.13, 0.12, 0.18);
      block(group, 0.18, 0.24, 0.5, pantsMaterial, 0.13, 0.12, 0.18);
      block(group, 0.15, 0.42, 0.18, shirt, -0.33, 0.39, 0.06);
      block(group, 0.15, 0.42, 0.18, shirt, 0.33, 0.39, 0.06);
      block(group, 0.48, 0.46, 0.46, offline ? offlineSkinMaterial : skinMaterial, 0, 0.88, 0);
      block(group, 0.5, 0.12, 0.5, offline ? offlineHairMaterial : hairMaterial, 0, 1.1, 0);
    } else {
      const legL = block(group, 0.18, 0.56, 0.2, pantsMaterial, -0.13, 0.28, 0);
      const legR = block(group, 0.18, 0.56, 0.2, pantsMaterial, 0.13, 0.28, 0);
      block(group, 0.52, 0.58, 0.3, shirt, 0, 0.87, 0);
      const armL = block(group, 0.15, 0.52, 0.18, shirt, -0.34, 0.87, 0);
      const armR = block(group, 0.15, 0.52, 0.18, shirt, 0.34, 0.87, 0);
      block(group, 0.48, 0.46, 0.46, offline ? offlineSkinMaterial : skinMaterial, 0, 1.4, 0);
      block(group, 0.5, 0.12, 0.5, offline ? offlineHairMaterial : hairMaterial, 0, 1.62, 0);
      block(group, 0.07, 0.07, 0.03, eyeMaterial, -0.1, 1.42, 0.235);
      block(group, 0.07, 0.07, 0.03, eyeMaterial, 0.1, 1.42, 0.235);
      // 用 userData 保存四肢，走路时前后摆
      group.userData.legL = legL;
      group.userData.legR = legR;
      group.userData.armL = armL;
      group.userData.armR = armR;
    }

    const label: AvatarLabel = {
      name: who.name,
      avatarText: who.avatar.text,
      color: who.avatar.color,
      offline,
      kind,
    };

    return {
      group,
      shirt,
      label,
      legL: group.userData.legL as THREE.Mesh | undefined,
      legR: group.userData.legR as THREE.Mesh | undefined,
      armL: group.userData.armL as THREE.Mesh | undefined,
      armR: group.userData.armR as THREE.Mesh | undefined,
    };
  }

  function disposeAvatar(handle: AvatarHandle): void {
    handle.group.removeFromParent();
    handle.shirt.dispose();
  }

  // ---------- 已坐玩家 ----------
  let seatedGroup: THREE.Group | null = null;
  let seatedHandles: AvatarHandle[] = [];
  let hostHandle: AvatarHandle | null = null;
  let preview = initialPreview;
  let lastSeatSignature = "";
  let disabled = false;
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clearSeated(): void {
    if (seatedGroup) {
      seatedGroup.removeFromParent();
      seatedGroup = null;
    }
    for (const handle of seatedHandles) disposeAvatar(handle);
    seatedHandles = [];
    if (hostHandle) {
      disposeAvatar(hostHandle);
      hostHandle = null;
    }
  }

  function buildSeated(): void {
    clearSeated();
    seatedGroup = new THREE.Group();
    scene.add(seatedGroup);

    for (const spot of chairSpots) {
      const view = preview.seats[spot.seat];
      if (view?.role !== "player") continue;
      const handle = createAvatar(
        { name: view.name, avatar: view.avatar },
        "sit",
        "player",
        !view.connected,
      );
      handle.group.position.set(spot.x * 0.94, CHAIR_SEAT_Y, spot.z * 0.94);
      handle.group.rotation.y = Math.atan2(-spot.x, -spot.z);
      seatedGroup.add(handle.group);
      seatedHandles.push(handle);
    }

    const hostSeat = preview.seats[preview.hostSeat];
    if (hostSeat?.role !== "player") {
      hostHandle = createAvatar(preview.host, "stand", "host");
      hostHandle.group.position.set(-4.15, 0, -1.0);
      hostHandle.group.rotation.y = Math.PI / 2;
      seatedGroup.add(hostHandle.group);
      addShadow(seatedGroup, -4.15, -1.0, 0.34);
    }
  }

  function seatSignature(value: RoomPreview): string {
    const seats = value.seats
      .map((seat) =>
        seat
          ? `${seat.seat}:${seat.role}:${seat.name}:${seat.avatar.text}:${seat.avatar.color}:${
              seat.connected ? 1 : 0
            }:${seat.id ?? ""}:${seat.ready ? 1 : 0}:${seat.x ?? ""}:${seat.z ?? ""}:${
              seat.facing ?? ""
            }`
          : "-",
      )
      .join("|");
    return `${value.code}|${value.hostSeat}|${value.host.name}|${value.host.avatar.text}|${value.host.avatar.color}|${seats}`;
  }

  // ---------- 自己的小人 ----------
  const localHandle = createAvatar(profile, "stand", "me");
  scene.add(localHandle.group);
  const localSeatedHandle = isLobby ? createAvatar(profile, "sit", "me") : null;
  if (localSeatedHandle) {
    localSeatedHandle.group.visible = false;
    scene.add(localSeatedHandle.group);
  }
  const localShadow = new THREE.Mesh(circleGeometry, shadowMaterial);
  localShadow.rotation.x = -Math.PI / 2;
  localShadow.scale.set(0.34, 0.34, 1);
  localShadow.position.set(ENTRY.x, 0.016, ENTRY.z);
  scene.add(localShadow);

  const player: Point = { x: ENTRY.x, z: ENTRY.z };
  let target: Point | null = null;
  const joystick = { x: 0, y: 0 };
  const keys = new Set<string>();
  let yaw = Math.PI;
  let walkPhase = 0;
  let time = 0;
  let nearSeat: number | null = null;
  let sitting: SitState | null = null;
  let disposed = false;
  let localSeatedNow = false;
  let lobbyPairs: LobbyPair[] = [];
  let lobbyLocalInitialized = false;
  let lobbyWasMoving = false;
  let lobbyLocalRole: Role | null = null;
  let lobbyLocalSeat = -1;
  let lobbyLocalReady = false;
  let lastLobbySentAt = 0;
  let lastLobbySentX = Number.NaN;
  let lastLobbySentZ = Number.NaN;
  let lastLobbySentFacing = Number.NaN;
  const LOBBY_TV = { x: -4.15, z: -1.0 };

  localHandle.group.position.set(player.x, 0, player.z);
  localHandle.group.rotation.y = yaw;

  // ---------- 大厅模式 ----------
  function lobbyLocalView(): RoomSeatView | null {
    if (!isLobby || !lobbyOptions) return null;
    return preview.seats.find((seat) => seat?.id === lobbyOptions.localId) ?? null;
  }

  function lobbySeatSpot(view: RoomSeatView | null): ChairSpot | null {
    if (view?.role !== "player") return null;
    return chairSpots.find((spot) => spot.seat === view.seat) ?? null;
  }

  function lobbyFallbackPosition(view: RoomSeatView | null): {
    x: number;
    z: number;
    seated: boolean;
  } {
    if (!view) return { x: LOBBY_TV.x, z: LOBBY_TV.z, seated: false };
    if (view.role === "screen") return { x: LOBBY_TV.x, z: LOBBY_TV.z, seated: false };
    const spot = lobbySeatSpot(view);
    if (!spot) return { x: ENTRY.x, z: ENTRY.z, seated: false };
    if (view.ready) {
      const center = seatCenter(spot);
      return { x: center.x, z: center.z, seated: true };
    }
    const stand = seatStand(spot);
    return { x: stand.x, z: stand.z, seated: false };
  }

  function lobbyPositionFor(
    view: RoomSeatView | null,
    useStored: boolean,
  ): { x: number; z: number; seated: boolean } {
    const fallback = lobbyFallbackPosition(view);
    const stored =
      useStored && view && typeof view.x === "number" && typeof view.z === "number"
        ? { x: view.x, z: view.z }
        : null;
    const x = stored?.x ?? fallback.x;
    const z = stored?.z ?? fallback.z;
    const spot = lobbySeatSpot(view);
    const seated = Boolean(view?.role === "player" && view.ready && spot && isNearSeat(x, z, spot));
    return { x, z, seated };
  }

  function placeLocalSeated(seated: boolean): void {
    localSeatedNow = seated;
    localHandle.group.visible = !seated;
    localShadow.visible = !seated;
    if (!localSeatedHandle) return;
    localSeatedHandle.group.visible = seated;
    if (!seated) return;
    const spot = lobbySeatSpot(lobbyLocalView());
    if (!spot) return;
    const center = seatCenter(spot);
    localSeatedHandle.group.position.set(center.x, CHAIR_SEAT_Y, center.z);
    localSeatedHandle.group.rotation.y = Math.atan2(-center.x, -center.z);
  }

  function sendLobbyPosition(force = false): void {
    if (!isLobby || !lobbyOptions) return;
    const now = performance.now();
    // 位置和朝向都先按服务端范围收好；朝向归一化到 [-π, π]，避免累积后越界
    const x = Math.min(5.2, Math.max(-5.2, player.x));
    const z = Math.min(4.2, Math.max(-4.2, player.z));
    const facing = normalizeAngle(yaw);
    if (!force && now - lastLobbySentAt < 90) return;
    if (
      !force &&
      Math.abs(x - lastLobbySentX) < 0.015 &&
      Math.abs(z - lastLobbySentZ) < 0.015 &&
      Math.abs(facing - lastLobbySentFacing) < 0.02
    ) {
      return;
    }
    lastLobbySentAt = now;
    lastLobbySentX = x;
    lastLobbySentZ = z;
    lastLobbySentFacing = facing;
    lobbyOptions.onMove(
      Math.round(x * 100) / 100,
      Math.round(z * 100) / 100,
      Math.round(facing * 100) / 100,
    );
  }

  function resetLobbyLocal(initial: boolean): void {
    if (!isLobby) return;
    const view = lobbyLocalView();
    const position = lobbyPositionFor(view, initial || !lobbyLocalInitialized);
    player.x = position.x;
    player.z = position.z;
    target = null;
    yaw = view?.facing ?? Math.PI;
    localHandle.group.position.set(player.x, 0, player.z);
    localHandle.group.rotation.y = yaw;
    localShadow.position.set(player.x, 0.016, player.z);
    placeLocalSeated(position.seated);
    lobbyLocalInitialized = true;
    lobbyLocalRole = view?.role ?? null;
    lobbyLocalSeat = view?.seat ?? -1;
    lobbyLocalReady = view?.ready === true;
    sendLobbyPosition(true);
  }

  function lobbyDefaultFor(view: RoomSeatView): Point {
    if (typeof view.x === "number" && typeof view.z === "number") {
      return { x: view.x, z: view.z };
    }
    if (view.role === "screen") return { x: LOBBY_TV.x, z: LOBBY_TV.z };
    const spot = lobbySeatSpot(view);
    if (!spot) return { x: ENTRY.x, z: ENTRY.z };
    return view.ready ? seatCenter(spot) : seatStand(spot);
  }

  function clearLobbyAvatars(): void {
    for (const pair of lobbyPairs) {
      disposeAvatar(pair.standing);
      if (pair.seated) disposeAvatar(pair.seated);
    }
    lobbyPairs = [];
  }

  function buildLobbyAvatars(): void {
    clearLobbyAvatars();
    if (!isLobby) return;
    const localId = lobbyOptions?.localId;
    for (const view of preview.seats) {
      if (!view || view.role === "spectator") continue;
      if (view.id && view.id === localId) continue;
      const spot = lobbySeatSpot(view);
      const screenHost = view.role === "screen" && view.seat === preview.hostSeat;
      const avatar = { name: view.name, avatar: view.avatar };
      const standing = createAvatar(
        avatar,
        "stand",
        screenHost ? "host" : "player",
        !view.connected,
      );
      const seated =
        view.role === "player" && spot
          ? createAvatar(avatar, "sit", "player", !view.connected)
          : null;
      const position = lobbyDefaultFor(view);
      const facing = view.facing ?? Math.atan2(-position.x, -position.z);
      standing.group.position.set(position.x, 0, position.z);
      standing.group.rotation.y = facing;
      const seatedNow = Boolean(
        view.role === "player" && view.ready && spot && isNearSeat(position.x, position.z, spot),
      );
      standing.group.visible = !seatedNow;
      if (seated && spot) {
        const center = seatCenter(spot);
        seated.group.position.set(center.x, CHAIR_SEAT_Y, center.z);
        seated.group.rotation.y = Math.atan2(-center.x, -center.z);
        seated.group.visible = seatedNow;
      }
      scene.add(standing.group);
      if (seated) scene.add(seated.group);
      lobbyPairs.push({
        id: view.id ?? `seat-${view.seat}`,
        role: view.role,
        ready: view.ready === true,
        spot,
        standing,
        seated,
        x: position.x,
        z: position.z,
        facing,
        isHost: screenHost,
        seatedNow,
      });
    }
  }

  function setLobbyMotion(motion: ReadonlyMap<string, LobbyMotion>): void {
    if (!isLobby) return;
    for (const pair of lobbyPairs) {
      const value = motion.get(pair.id);
      if (value) {
        pair.x = value.x;
        pair.z = value.z;
        pair.facing = value.facing;
      }
      const seatedNow = Boolean(
        pair.role === "player" && pair.ready && pair.spot && isNearSeat(pair.x, pair.z, pair.spot),
      );
      pair.seatedNow = seatedNow;
      pair.standing.group.position.set(pair.x, 0, pair.z);
      pair.standing.group.rotation.y = pair.facing;
      pair.standing.group.visible = !seatedNow;
      if (pair.seated) pair.seated.group.visible = seatedNow;
    }
  }

  // ---------- 清晰名字牌（覆盖在像素画布上，文字不做像素化） ----------
  function drawAvatarLabel(handle: AvatarHandle, offsetY: number): void {
    if (!labelCtx) return;
    const s = labelScale;
    const position = handle.group.position;
    labelProjection.set(position.x, position.y + offsetY, position.z).project(camera);
    if (labelProjection.z < -1 || labelProjection.z > 1) return;

    const anchorX = (labelProjection.x * 0.5 + 0.5) * labelWidth;
    const anchorY = (-labelProjection.y * 0.5 + 0.5) * labelHeight;
    if (
      anchorX < -100 ||
      anchorX > labelWidth + 100 ||
      anchorY < -40 ||
      anchorY > labelHeight + 40
    ) {
      return;
    }

    const label = handle.label;
    const suffix =
      label.kind === "host"
        ? " · 大屏"
        : label.kind === "me"
          ? "（你）"
          : label.offline
            ? " · 掉线"
            : "";
    const fullText = `${label.name}${suffix}`;
    labelCtx.font = `600 ${12 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    let text = fullText;
    while (text.length > 1 && labelCtx.measureText(text).width > 128 * s) {
      text = text.slice(0, -1);
    }
    if (text !== fullText) text = `${text.slice(0, -1)}…`;
    const textWidth = labelCtx.measureText(text).width;
    const boxWidth = 30 * s + textWidth;
    const boxHeight = 22 * s;
    const boxX = Math.max(3 * s, Math.min(labelWidth - boxWidth - 3 * s, anchorX - boxWidth / 2));
    const boxY = Math.max(3, anchorY - boxHeight - 4 * s);
    const borderColor = label.offline ? "#5b6673" : label.color;

    labelCtx.fillStyle = "rgba(6, 11, 9, 0.88)";
    labelCtx.fillRect(boxX, boxY, boxWidth, boxHeight);
    labelCtx.strokeStyle = borderColor;
    labelCtx.lineWidth = 1;
    labelCtx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);

    // 头像色块
    labelCtx.fillStyle = label.color;
    labelCtx.fillRect(boxX + 4 * s, boxY + 4 * s, 14 * s, 14 * s);
    labelCtx.fillStyle = "#06110c";
    labelCtx.font = `700 ${10 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    labelCtx.textAlign = "center";
    labelCtx.textBaseline = "middle";
    labelCtx.fillText([...label.avatarText].slice(0, 2).join(""), boxX + 11 * s, boxY + 11.5 * s);

    // 名字
    labelCtx.fillStyle = label.offline ? "#8a9bad" : "#e9f0f7";
    labelCtx.font = `600 ${12 * s}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    labelCtx.textAlign = "left";
    labelCtx.fillText(text, boxX + 24 * s, boxY + 11.5 * s);
    labelCtx.textAlign = "start";
    labelCtx.textBaseline = "alphabetic";
  }

  function drawLabels(): void {
    if (!labelCtx) return;
    labelCtx.save();
    labelCtx.setTransform(1, 0, 0, 1, 0, 0);
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelCtx.restore();

    if (isLobby) {
      for (const pair of lobbyPairs) {
        const handle = pair.seatedNow && pair.seated ? pair.seated : pair.standing;
        drawAvatarLabel(handle, pair.seatedNow ? 1.55 : 1.98);
      }
      const activeLocal = localSeatedNow && localSeatedHandle ? localSeatedHandle : localHandle;
      drawAvatarLabel(activeLocal, localSeatedNow ? 1.55 : 1.98);
      return;
    }

    for (const handle of seatedHandles) drawAvatarLabel(handle, 1.55);
    if (hostHandle) drawAvatarLabel(hostHandle, 1.98);
    drawAvatarLabel(localHandle, sitting ? 1.55 : 1.98);
  }

  function refreshChairLayout(): void {
    chairSpots = buildChairSpots(preview.seats);
    colliders = buildColliders(chairSpots);
    buildChairs();
    if (nearSeat !== null && !chairSpots.some((spot) => spot.seat === nearSeat && !spot.occupied)) {
      nearSeat = null;
      callbacks.onNearSeat(null);
    }
  }

  function setNearSeat(next: number | null): void {
    if (nearSeat === next) return;
    nearSeat = next;
    callbacks.onNearSeat(next);
  }

  function updateNearSeat(): void {
    if (disabled || sitting) {
      setNearSeat(null);
      return;
    }
    const spot = nearestEmptyChair(player, chairSpots, NEAR_DISTANCE);
    setNearSeat(spot?.seat ?? null);
  }

  // ---------- 输入 ----------
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerStart = { x: 0, y: 0, active: false };

  function clampPoint(point: Point): Point {
    return {
      x: Math.min(ROOM.maxX - 0.3, Math.max(ROOM.minX + 0.3, point.x)),
      z: Math.min(ROOM.maxZ - 0.3, Math.max(ROOM.minZ + 0.3, point.z)),
    };
  }

  function onPointerDown(event: PointerEvent): void {
    pointerStart.x = event.clientX;
    pointerStart.y = event.clientY;
    pointerStart.active = true;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pointerStart.active) return;
    pointerStart.active = false;
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 12) return;
    if (disabled || sitting) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return;

    const spot = chairNearPoint({ x: hit.x, z: hit.z }, chairSpots);
    if (spot) {
      const view = preview.seats[spot.seat];
      if (spot.occupied && view) {
        callbacks.onSeatSelect(view);
        return;
      }
      target = { x: spot.standX, z: spot.standZ };
      joystick.x = 0;
      joystick.y = 0;
      return;
    }

    // 点到桌面不移动，避免一直顶着桌子走
    if (Math.hypot(hit.x, hit.z) < TABLE_RADIUS + 0.35) return;
    target = clampPoint({ x: hit.x, z: hit.z });
  }

  function onKeyDown(event: KeyboardEvent): void {
    const targetElement = event.target as HTMLElement | null;
    if (
      targetElement &&
      (targetElement.tagName === "INPUT" ||
        targetElement.tagName === "TEXTAREA" ||
        targetElement.tagName === "SELECT")
    ) {
      return;
    }
    if (MOVE_KEYS.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
      target = null;
    }
    if (
      !isLobby &&
      (event.code === "Space" || event.code === "Enter" || event.code === "KeyE") &&
      nearSeat !== null &&
      !sitting &&
      !disabled
    ) {
      event.preventDefault();
      sit();
    }
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }

  function onLost(event: Event): void {
    event.preventDefault();
    if (!disposed) callbacks.onUnavailable("context-lost");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("webglcontextlost", onLost);

  // ---------- 坐下 / 站起 ----------
  function findSpot(seat?: number): ChairSpot | null {
    if (seat !== undefined) {
      const spot = chairSpots.find((item) => item.seat === seat && !item.occupied);
      return spot ?? null;
    }
    return nearestEmptyChair(player, chairSpots, 1.4);
  }

  function sit(seat?: number): void {
    if (isLobby || disabled || sitting) return;
    const spot = findSpot(seat);
    if (!spot) return;
    if (distance(player, { x: spot.standX, z: spot.standZ }) > 1.05) {
      target = { x: spot.standX, z: spot.standZ };
      return;
    }
    target = null;
    joystick.x = 0;
    joystick.y = 0;
    setNearSeat(null);
    sitting = {
      seat: spot.seat,
      mode: "sit",
      elapsed: 0,
      from: { ...player },
      to: { x: spot.x * 0.94, z: spot.z * 0.94 },
      fromY: 0,
      toY: 0.3,
      requested: false,
    };
  }

  function standUp(): void {
    if (isLobby || !sitting) return;
    const spot = chairSpots.find((item) => item.seat === sitting?.seat);
    if (!spot) {
      sitting = null;
      return;
    }
    sitting = {
      seat: sitting.seat,
      mode: "stand",
      elapsed: 0,
      from: { ...player },
      to: { x: spot.standX, z: spot.standZ },
      fromY: localHandle.group.position.y,
      toY: 0,
      requested: true,
    };
  }

  // ---------- 每帧 ----------
  function updateMovement(dt: number): { moved: boolean; direction: Point | null } {
    let inputX = joystick.x;
    let inputY = joystick.y;
    if (keys.has("KeyW") || keys.has("ArrowUp")) inputY += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) inputY -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) inputX -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) inputX += 1;

    const inputLength = Math.hypot(inputX, inputY);
    if (inputLength > 0.08) {
      target = null;
      const nx = inputX / Math.max(1, inputLength);
      const ny = inputY / Math.max(1, inputLength);
      // 屏幕右 = 世界 (1,-1)，屏幕前 = 世界 (-1,-1)，与 45° 机位对齐
      const direction = {
        x: (nx * 1 + ny * -1) * Math.SQRT1_2,
        z: (nx * -1 + ny * -1) * Math.SQRT1_2,
      };
      const length = Math.hypot(direction.x, direction.z) || 1;
      const step = {
        x: (direction.x / length) * WALK_SPEED * dt,
        z: (direction.z / length) * WALK_SPEED * dt,
      };
      const next = resolveMovement(player, step, colliders);
      player.x = next.x;
      player.z = next.z;
      return { moved: true, direction: { x: direction.x, z: direction.z } };
    }

    if (inputLength > 0) {
      joystick.x = 0;
      joystick.y = 0;
    }

    if (target) {
      const dx = target.x - player.x;
      const dz = target.z - player.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.06) {
        target = null;
      } else {
        const stepLength = Math.min(length, WALK_SPEED * dt);
        const next = resolveMovement(
          player,
          { x: (dx / length) * stepLength, z: (dz / length) * stepLength },
          colliders,
        );
        const moved = Math.hypot(next.x - player.x, next.z - player.z);
        player.x = next.x;
        player.z = next.z;
        return { moved: moved > 0.0005, direction: { x: dx / length, z: dz / length } };
      }
    }

    return { moved: false, direction: null };
  }

  function update(dt: number): void {
    time += dt;
    let localY = 0;
    let moving = false;
    let direction: Point | null = null;

    if (sitting) {
      sitting.elapsed += dt;
      const duration = sitting.mode === "sit" ? SIT_SECONDS : STAND_SECONDS;
      const progress = Math.min(1, sitting.elapsed / duration);
      const eased = ease(progress);
      player.x = lerp(sitting.from.x, sitting.to.x, eased);
      player.z = lerp(sitting.from.z, sitting.to.z, eased);
      localY = lerp(sitting.fromY, sitting.toY, eased);
      if (progress >= 1) {
        if (sitting.mode === "sit") {
          if (!sitting.requested) {
            sitting.requested = true;
            callbacks.onSitRequest(sitting.seat);
          }
        } else {
          sitting = null;
          updateNearSeat();
        }
      }
    } else {
      const movement = updateMovement(dt);
      moving = movement.moved;
      direction = movement.direction;
    }

    if (moving && direction) {
      yaw = lerpAngle(yaw, Math.atan2(direction.x, direction.z), Math.min(1, dt * 12));
      walkPhase += dt * 9;
    } else if (!sitting) {
      walkPhase = 0;
    }

    const swing = moving ? Math.sin(walkPhase) : 0;
    if (localHandle.legL && localHandle.legR) {
      localHandle.legL.position.z = swing * 0.13;
      localHandle.legR.position.z = -swing * 0.13;
    }
    if (localHandle.armL && localHandle.armR) {
      localHandle.armL.position.z = -swing * 0.1;
      localHandle.armR.position.z = swing * 0.1;
    }

    if (sitting?.mode === "sit") {
      // 坐向桌心
      yaw = lerpAngle(yaw, Math.atan2(-player.x, -player.z), Math.min(1, dt * 8));
    }

    const bob = moving && !reducedMotion ? Math.abs(Math.sin(walkPhase)) * 0.04 : 0;
    localHandle.group.position.set(player.x, localY + bob, player.z);
    localHandle.group.rotation.y = yaw;
    localShadow.position.set(player.x, 0.016, player.z);

    if (!sitting) updateNearSeat();

    if (isLobby) {
      const view = lobbyLocalView();
      const spot = lobbySeatSpot(view);
      const seated = Boolean(
        view?.role === "player" &&
          view.ready &&
          spot &&
          !sitting &&
          !moving &&
          isNearSeat(player.x, player.z, spot),
      );
      if (seated !== localSeatedNow) placeLocalSeated(seated);
      if (seated) {
        localHandle.group.visible = false;
        localShadow.visible = false;
        if (localSeatedHandle) localSeatedHandle.group.visible = true;
      } else {
        localHandle.group.visible = true;
        localShadow.visible = true;
        if (localSeatedHandle) localSeatedHandle.group.visible = false;
      }
      if (moving) sendLobbyPosition();
      else if (lobbyWasMoving) sendLobbyPosition(true);
      lobbyWasMoving = moving;
    }

    for (const spot of chairSpots) {
      const highlight = highlights.get(spot.seat);
      if (!highlight) continue;
      const material = highlight.material as THREE.MeshBasicMaterial;
      if (disabled || spot.occupied) {
        material.opacity = 0;
        continue;
      }
      const pulse = reducedMotion ? 0 : Math.sin(time * 3 + spot.seat) * 0.12;
      material.opacity = (nearSeat === spot.seat ? 0.9 : 0.3) + pulse;
      const scale = nearSeat === spot.seat ? 1.18 : 1;
      highlight.scale.set(scale, scale, 1);
    }

    if (!reducedMotion) {
      candleLight.intensity = 6.4 + Math.sin(time * 8) * 0.5 + Math.sin(time * 13) * 0.25;
    }
  }

  let raf = 0;
  let lastFrame = performance.now();
  let lastRender = 0;

  function frame(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (document.visibilityState !== "visible") {
      lastFrame = now;
      return;
    }
    if (now - lastRender < 31) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    lastRender = now;
    update(dt);
    renderer.render(scene, camera);
    drawLabels();
  }

  // ---------- 尺寸 ----------
  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const aspect = rect.width / rect.height;
    const pixelWidth = Math.max(180, Math.round(renderHeight * aspect));
    renderer.setSize(pixelWidth, renderHeight, false);
    const view = cameraView(aspect);
    camera.left = -view.width / 2;
    camera.right = view.width / 2;
    camera.top = view.height / 2;
    camera.bottom = -view.height / 2;
    camera.updateProjectionMatrix();

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    labelWidth = rect.width;
    labelHeight = rect.height;
    labelCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    labelCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    labelCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelScale = isLobby ? Math.max(1, Math.min(2, rect.height / 340)) : 1;
    // 后台标签页的 rAF 会被暂停；先渲染一帧，避免大厅/入座场景出现黑块
    update(0);
    renderer.render(scene, camera);
    drawLabels();
  }

  // ---------- 对外 ----------
  function setPreview(next: RoomPreview): void {
    const codeChanged = next.code !== preview.code;
    preview = next;
    if (codeChanged) {
      const screenMap = screenMaterial.map;
      const texture = createScreenTexture(next.code);
      textures.add(texture);
      screenMaterial.map = texture;
      screenMaterial.needsUpdate = true;
      if (screenMap) screenMap.dispose();
    }
    const signature = seatSignature(next);
    if (signature !== lastSeatSignature) {
      lastSeatSignature = signature;
      refreshChairLayout();
      if (isLobby) {
        buildLobbyAvatars();
        placeLocalSeated(localSeatedNow);
      } else {
        buildSeated();
      }
    }
    if (isLobby) {
      const local = lobbyLocalView();
      const role = local?.role ?? null;
      const seat = local?.seat ?? -1;
      const ready = local?.ready === true;
      if (
        !lobbyLocalInitialized ||
        role !== lobbyLocalRole ||
        seat !== lobbyLocalSeat ||
        ready !== lobbyLocalReady
      ) {
        resetLobbyLocal(!lobbyLocalInitialized);
      }
    }
  }

  function setProfile(next: LocalProfile): void {
    const label = {
      name: next.name,
      avatarText: next.avatar.text,
      color: next.avatar.color,
      offline: false,
      kind: "me" as const,
    };
    localHandle.shirt.color.set(next.avatar.color);
    localHandle.label = label;
    if (localSeatedHandle) {
      localSeatedHandle.shirt.color.set(next.avatar.color);
      localSeatedHandle.label = label;
    }
  }

  function setDisabled(next: boolean): void {
    disabled = next;
    if (disabled) {
      target = null;
      joystick.x = 0;
      joystick.y = 0;
      setNearSeat(null);
    }
  }

  function setJoystick(x: number, y: number): void {
    const length = Math.hypot(x, y);
    if (length > 1) {
      joystick.x = x / length;
      joystick.y = y / length;
    } else {
      joystick.x = x;
      joystick.y = y;
    }
    if (length > 0.1) target = null;
  }

  function dispose(): void {
    disposed = true;
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("webglcontextlost", onLost);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    disposeChairGroup();
    clearSeated();
    clearLobbyAvatars();
    disposeAvatar(localHandle);
    if (localSeatedHandle) disposeAvatar(localSeatedHandle);
    scene.remove(localShadow);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  refreshChairLayout();
  if (isLobby) {
    buildLobbyAvatars();
    resetLobbyLocal(true);
  } else {
    buildSeated();
  }
  lastSeatSignature = seatSignature(initialPreview);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    resize,
    setPreview,
    setProfile,
    setDisabled,
    setJoystick,
    setLobbyMotion,
    sit,
    standUp,
    dispose,
  };
}
