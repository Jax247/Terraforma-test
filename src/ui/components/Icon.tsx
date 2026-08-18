// The icon registry.
//
// Icons are referenced by *meaning* ("leader", "spring-active", "stunned"), never by
// the drawing. That keeps the emoji-to-glyph swap a one-line edit in this file, and
// stops a given concept drifting to two different pictures on two screens.
//
// Emoji are deliberately gone from chrome: they render differently on every OS and
// undercut the themed look. Board markers are the exception worth revisiting — some
// read better as emoji at 16px than any stroke icon does.

import clsx from 'clsx';
import {
  Bot,
  BookOpen,
  BrickWall,
  Check,
  Copy,
  Crosshair,
  Crown,
  Dices,
  Droplet,
  EyeOff,
  Flame,
  Footprints,
  Grid3x3,
  Hammer,
  Info,
  Layers,
  Map as MapIcon,
  Menu,
  Mountain,
  Pencil,
  Settings,
  Shield,
  Skull,
  Sparkles,
  Sword,
  Swords,
  Target,
  Trash2,
  Trees,
  TriangleAlert,
  Users,
  WavesHorizontal,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const ICONS = {
  // --- Navigation / chrome ---
  game: Swords,
  decks: Layers,
  build: Hammer,
  boards: Grid3x3,
  online: Users,
  settings: Settings,
  menu: Menu,
  close: X,
  info: Info,
  check: Check,
  copy: Copy,
  warning: TriangleAlert,
  log: BookOpen,
  edit: Pencil,
  delete: Trash2,
  map: MapIcon,
  random: Dices,
  ai: Bot,

  // --- Connection ---
  connected: Wifi,
  disconnected: WifiOff,

  // --- Board markers ---
  leader: Crown,
  wall: BrickWall,
  springActive: Droplet,
  springDormant: Droplet, // differentiated by colour + a `dormant` class, not shape
  sigil: Sparkles,
  defending: Shield,
  move: Footprints,
  shoot: Crosshair,
  target: Target,

  // --- Statuses (the denial axis) ---
  snared: Footprints,
  disarmed: Sword,
  stunned: Zap,
  suppressed: EyeOff,
  sick: Skull,

  // --- Terrain (deck/board editor legends) ---
  forest: Trees,
  mountain: Mountain,
  sea: WavesHorizontal,
  desert: Flame,
  shadow: EyeOff,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** Pixel size. Defaults to 1em so icons scale with surrounding text. */
  size?: number | string;
  className?: string;
  /**
   * Accessible name. Omit for decorative icons sitting beside a text label —
   * they are then hidden from assistive tech, which is what you want.
   */
  label?: string;
}

export function Icon({ name, size = '1em', className, label }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      className={clsx('icon', className)}
      strokeWidth={2}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}
