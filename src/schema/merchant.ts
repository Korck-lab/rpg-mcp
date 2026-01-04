import { z } from 'zod';

export const MerchantInventoryItemSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().min(0),
  lastRestocked: z.string().optional()
});

export const MerchantSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['general_store', 'weaponsmith', 'armorer', 'apothecary', 'magic_shop', 'fence']),
  disposition: z.number().int().min(-100).max(100),
  inventory: z.array(MerchantInventoryItemSchema),
  location: z.string().optional(), // room_id where merchant is located
  lastRestock: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Merchant = z.infer<typeof MerchantSchema>;
export type MerchantInventoryItem = z.infer<typeof MerchantInventoryItemSchema>;