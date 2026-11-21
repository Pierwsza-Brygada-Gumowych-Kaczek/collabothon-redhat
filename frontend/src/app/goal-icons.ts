import {
  Car,
  ChefHat,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  LucideIconData,
  PiggyBank,
  Plane,
  Rocket,
  Shield,
  TrendingUp,
} from 'lucide-angular';

export interface GoalIcon {
  /** Stored with the goal; must match GOAL_ICONS in the backend. */
  key: string;
  label: string;
  icon: LucideIconData;
  /** Guide colour of the icon: used for its badge and the header of a goal without a picture. */
  color: string;
}

/** Icons most often used for business and personal savings goals, each with its own colour. */
export const GOAL_ICONS: GoalIcon[] = [
  { key: 'piggy-bank', label: 'Savings', icon: PiggyBank, color: '#e64980' },
  { key: 'shield', label: 'Safety reserve', icon: Shield, color: '#12b886' },
  { key: 'house', label: 'Property', icon: House, color: '#f59f00' },
  { key: 'car', label: 'Vehicle', icon: Car, color: '#1c7ed6' },
  { key: 'plane', label: 'Holiday', icon: Plane, color: '#15aabf' },
  { key: 'graduation-cap', label: 'Training', icon: GraduationCap, color: '#7048e8' },
  { key: 'laptop', label: 'Equipment & tech', icon: Laptop, color: '#4263eb' },
  { key: 'chef-hat', label: 'Kitchen', icon: ChefHat, color: '#e8590c' },
  { key: 'heart-pulse', label: 'Health', icon: HeartPulse, color: '#e03131' },
  { key: 'gift', label: 'Gift or event', icon: Gift, color: '#ae3ec9' },
  { key: 'trending-up', label: 'Investment', icon: TrendingUp, color: '#2f9e44' },
  { key: 'rocket', label: 'New project', icon: Rocket, color: '#0b7285' },
];

const BY_KEY = new Map(GOAL_ICONS.map((i) => [i.key, i]));

export const goalIcon = (key: string | null | undefined): GoalIcon | null => (key ? (BY_KEY.get(key) ?? null) : null);
