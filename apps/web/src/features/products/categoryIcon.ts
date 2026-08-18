import {
  BookOpen,
  Dumbbell,
  Gamepad2,
  HeartPulse,
  House,
  Laptop,
  Package,
  PenTool,
  Shirt,
  ShoppingBasket,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/**
 * A glyph per product category.
 *
 * The reference design shows product photographs; no image field exists in the
 * contract and inventing one would mean shipping placeholder art. A category
 * glyph gives the same visual anchor from data that is actually there.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  Electronics: Laptop,
  'Home & Kitchen': House,
  Fashion: Shirt,
  Beauty: Sparkles,
  Grocery: ShoppingBasket,
  'Sports & Fitness': Dumbbell,
  Books: BookOpen,
  'Toys & Games': Gamepad2,
  Stationery: PenTool,
  'Personal Care': HeartPulse,
};

/** Unknown categories — including any the backend adds later — fall back safely. */
export function categoryIcon(category: string): LucideIcon {
  return ICONS[category] ?? Package;
}
