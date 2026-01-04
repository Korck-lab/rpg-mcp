import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getDb } from '../storage/index.js';
import { SessionContext } from './types.js';
import { RichFormatter } from './utils/formatter.js';
import { MerchantRepository } from '../storage/repos/merchant.repo.js';
import { CharacterRepository } from '../storage/repos/character.repo.js';
import { InventoryRepository } from '../storage/repos/inventory.repo.js';
import { ItemRepository } from '../storage/repos/item.repo.js';

function ensureDb() {
    const dbPath = process.env.NODE_ENV === 'test'
        ? ':memory:'
        : process.env.RPG_DATA_DIR
            ? `${process.env.RPG_DATA_DIR}/rpg.db`
            : 'rpg.db';
    const db = getDb(dbPath);
    const merchantRepo = new MerchantRepository(db);
    const charRepo = new CharacterRepository(db);
    const inventoryRepo = new InventoryRepository(db);
    const itemRepo = new ItemRepository(db);
    return { merchantRepo, charRepo, inventoryRepo, itemRepo };
}

export const TradingTools = {
    GET_MERCHANT_INVENTORY: {
        name: 'get_merchant_inventory',
        description: 'Get the inventory of a specific merchant NPC.',
        inputSchema: z.object({
            merchantId: z.string().describe('Unique identifier for the merchant NPC')
        })
    },
    CALCULATE_BUY_PRICE: {
        name: 'calculate_buy_price',
        description: 'Calculate the price to buy an item from a merchant.',
        inputSchema: z.object({
            itemId: z.string().describe('ID of the item to purchase'),
            merchantId: z.string().describe('ID of the merchant selling the item'),
            quantity: z.number().int().min(1).default(1).describe('Number of items to buy'),
            haggleDiscount: z.number().min(0).max(100).default(0).describe('Percentage discount from haggling (0-100)')
        })
    },
    CALCULATE_SELL_PRICE: {
        name: 'calculate_sell_price',
        description: 'Calculate the price received for selling an item to a merchant.',
        inputSchema: z.object({
            itemId: z.string().describe('ID of the item to sell'),
            merchantId: z.string().describe('ID of the merchant buying the item'),
            quantity: z.number().int().min(1).default(1).describe('Number of items to sell')
        })
    },
    EXECUTE_BUY_TRANSACTION: {
        name: 'execute_buy_transaction',
        description: 'Execute a purchase transaction with a merchant.',
        inputSchema: z.object({
            merchantId: z.string().describe('ID of the merchant to buy from'),
            characterId: z.string().describe('ID of the character making the purchase'),
            items: z.array(z.object({
                itemId: z.string(),
                quantity: z.number().int().min(1),
                price: z.number().min(0)
            })).describe('List of items to purchase with quantities and prices')
        })
    },
    EXECUTE_SELL_TRANSACTION: {
        name: 'execute_sell_transaction',
        description: 'Execute a sale transaction with a merchant.',
        inputSchema: z.object({
            merchantId: z.string().describe('ID of the merchant to sell to'),
            characterId: z.string().describe('ID of the character making the sale'),
            items: z.array(z.object({
                itemId: z.string(),
                quantity: z.number().int().min(1),
                sellPrice: z.number().min(0)
            })).describe('List of items to sell with quantities and prices')
        })
    },
    GET_CHARACTER_GOLD: {
        name: 'get_character_gold',
        description: 'Get the current gold amount for a character.',
        inputSchema: z.object({
            characterId: z.string().describe('ID of the character')
        })
    },
    UPDATE_CHARACTER_GOLD: {
        name: 'update_character_gold',
        description: 'Update a character\'s gold amount.',
        inputSchema: z.object({
            characterId: z.string().describe('ID of the character'),
            goldAmount: z.number().min(0).describe('New gold amount')
        })
    }
} as const;

export async function handleGetMerchantInventory(args: unknown, _ctx: SessionContext) {
    const { merchantRepo, itemRepo } = ensureDb();
    const parsed = TradingTools.GET_MERCHANT_INVENTORY.inputSchema.parse(args);

    // Get merchant data
    const merchantResult = merchantRepo.findById(parsed.merchantId);
    if (!merchantResult.success || !merchantResult.data) {
        throw new Error(merchantResult.error || `Merchant not found: ${parsed.merchantId}`);
    }
    const merchant = merchantResult.data;

    // Get inventory items with full details
    const inventoryItems = [];
    for (const inventoryItem of merchant.inventory) {
        const itemResult = itemRepo.findById(inventoryItem.itemId);
        if (itemResult.success && itemResult.data) {
            inventoryItems.push({
                id: inventoryItem.itemId,
                name: itemResult.data.name,
                quantity: inventoryItem.quantity,
                basePrice: itemResult.data.value,
                type: itemResult.data.type,
                rarity: itemResult.data.properties?.rarity || 'common',
                description: itemResult.data.description
            });
        }
    }

    const response = {
        merchant: {
            name: merchant.name,
            disposition: merchant.disposition,
            shopType: merchant.type
        },
        items: inventoryItems
    };

    let output = RichFormatter.header('Merchant Inventory', '🏪');
    output += RichFormatter.keyValue({
        'Merchant': merchant.name,
        'Type': merchant.type,
        'Disposition': `${merchant.disposition}/100`,
        'Items': inventoryItems.length
    });

    if (inventoryItems.length > 0) {
        const rows = inventoryItems.map(item => [
            item.name,
            item.type,
            item.quantity.toString(),
            `${item.basePrice} gp`
        ]);
        output += RichFormatter.table(['Item', 'Type', 'Qty', 'Price'], rows);
    } else {
        output += RichFormatter.alert('No items in stock.', 'info');
    }

    output += RichFormatter.embedJson(response, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleCalculateBuyPrice(args: unknown, _ctx: SessionContext) {
    const { merchantRepo, itemRepo, charRepo } = ensureDb();
    const parsed = TradingTools.CALCULATE_BUY_PRICE.inputSchema.parse(args);

    // Get merchant and item data
    const merchantResult = merchantRepo.findById(parsed.merchantId);
    if (!merchantResult.success || !merchantResult.data) {
        throw new Error(merchantResult.error || `Merchant not found: ${parsed.merchantId}`);
    }
    const merchant = merchantResult.data;

    const itemResult = itemRepo.findById(parsed.itemId);
    if (!itemResult.success || !itemResult.data) {
        throw new Error(itemResult.error || `Item not found: ${parsed.itemId}`);
    }
    const item = itemResult.data;

    // Get character for CHA modifier
    const charResult = charRepo.findById(parsed.merchantId); // Using merchantId as character for now
    const chaMod = charResult.success && charResult.data ?
        Math.floor((charResult.data.stats.cha - 10) / 2) : 0;

    // Calculate base price with modifiers
    const basePrice = item.value * parsed.quantity;
    const chaModifier = Math.min(Math.max(chaMod * 0.05, -0.25), 0.25); // ±5% per CHA point, max ±25%
    const dispositionModifier = getDispositionModifier(merchant.disposition);
    const haggleModifier = parsed.haggleDiscount / 100;

    const finalPrice = Math.round(basePrice *
        (1 + chaModifier) *
        dispositionModifier *
        (1 - haggleModifier)
    );

    const response = {
        priceCalculation: {
            basePrice: basePrice,
            reputationModifier: Math.round((dispositionModifier - 1) * 100),
            haggleDiscount: parsed.haggleDiscount,
            finalPrice: finalPrice,
            currencyBreakdown: { gp: finalPrice, sp: 0, cp: 0 }
        }
    };

    let output = RichFormatter.header('Price Calculation', '💰');
    output += RichFormatter.keyValue({
        'Item': item.name,
        'Quantity': parsed.quantity,
        'Base Price': `${basePrice} gp`,
        'Final Price': `${finalPrice} gp`
    });

    output += RichFormatter.embedJson(response, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleCalculateSellPrice(args: unknown, _ctx: SessionContext) {
    const { itemRepo } = ensureDb();
    const parsed = TradingTools.CALCULATE_SELL_PRICE.inputSchema.parse(args);

    const itemResult = itemRepo.findById(parsed.itemId);
    if (!itemResult.success || !itemResult.data) {
        throw new Error(itemResult.error || `Item not found: ${parsed.itemId}`);
    }
    const item = itemResult.data;

    // Selling price is 50% of base value per PHB
    const basePrice = item.value * parsed.quantity;
    const sellPrice = Math.floor(basePrice * 0.5);

    const response = {
        priceCalculation: {
            basePrice: basePrice,
            reputationModifier: 0,
            finalPrice: sellPrice,
            currencyBreakdown: { gp: sellPrice, sp: 0, cp: 0 }
        }
    };

    let output = RichFormatter.header('Sell Price', '💸');
    output += RichFormatter.keyValue({
        'Item': item.name,
        'Quantity': parsed.quantity,
        'Base Value': `${basePrice} gp`,
        'Sell Price': `${sellPrice} gp`
    });

    output += RichFormatter.embedJson(response, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleExecuteBuyTransaction(args: unknown, _ctx: SessionContext) {
    const { merchantRepo, inventoryRepo, charRepo } = ensureDb();
    const parsed = TradingTools.EXECUTE_BUY_TRANSACTION.inputSchema.parse(args);

    // Get character gold
    const charResult = charRepo.findById(parsed.characterId);
    if (!charResult.success || !charResult.data) {
        throw new Error(charResult.error || `Character not found: ${parsed.characterId}`);
    }
    const character = charResult.data;

    // Calculate total cost
    let totalCost = 0;
    for (const item of parsed.items) {
        totalCost += item.price * item.quantity;
    }

    // Check if character has enough gold
    if (character.currency.gold < totalCost) {
        const response = {
            transaction: {
                success: false,
                errorMessage: `Insufficient funds. Required: ${totalCost} gp, Available: ${character.currency.gold} gp`
            }
        };

        let output = RichFormatter.header('Transaction Failed', '❌');
        output += RichFormatter.alert(response.transaction.errorMessage, 'error');
        output += RichFormatter.embedJson(response, 'STATE');

        return {
            content: [{
                type: 'text' as const,
                text: output
            }]
        };
    }

    // Execute transaction
    const transactionId = randomUUID();

    // Add items to character inventory
    for (const item of parsed.items) {
        inventoryRepo.addItem(parsed.characterId, item.itemId, item.quantity);
    }

    // Deduct gold
    charRepo.update(parsed.characterId, {
        currency: {
            ...character.currency,
            gold: character.currency.gold - totalCost
        }
    });

    const response = {
        transaction: {
            success: true,
            transactionId: transactionId,
            totalAmount: totalCost
        }
    };

    let output = RichFormatter.header('Purchase Complete', '✅');
    output += RichFormatter.keyValue({
        'Transaction ID': `\`${transactionId}\``,
        'Total Cost': `${totalCost} gp`,
        'Items Purchased': parsed.items.length
    });
    output += RichFormatter.success('Transaction completed successfully!');

    output += RichFormatter.embedJson(response, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleExecuteSellTransaction(args: unknown, _ctx: SessionContext) {
    const { inventoryRepo, charRepo } = ensureDb();
    const parsed = TradingTools.EXECUTE_SELL_TRANSACTION.inputSchema.parse(args);

    // Get character
    const charResult = charRepo.findById(parsed.characterId);
    if (!charResult.success || !charResult.data) {
        throw new Error(charResult.error || `Character not found: ${parsed.characterId}`);
    }
    const character = charResult.data;

    // Calculate total earnings
    let totalEarnings = 0;
    for (const item of parsed.items) {
        totalEarnings += item.sellPrice * item.quantity;
    }

    // Verify character has items
    for (const item of parsed.items) {
        const inventory = inventoryRepo.getInventory(parsed.characterId);
        const hasItem = inventory.items.find(i => i.itemId === item.itemId && i.quantity >= item.quantity);
        if (!hasItem) {
            const response = {
                transaction: {
                    success: false,
                    errorMessage: `Insufficient quantity of item ${item.itemId}`
                }
            };

            let output = RichFormatter.header('Transaction Failed', '❌');
            output += RichFormatter.alert(response.transaction.errorMessage, 'error');
            output += RichFormatter.embedJson(response, 'STATE');

            return {
                content: [{
                    type: 'text' as const,
                    text: output
                }]
            };
        }
    }

    // Execute transaction
    const transactionId = randomUUID();

    // Remove items from character inventory
    for (const item of parsed.items) {
        inventoryRepo.removeItem(parsed.characterId, item.itemId, item.quantity);
    }

    // Add gold
    charRepo.update(parsed.characterId, {
        currency: {
            ...character.currency,
            gold: character.currency.gold + totalEarnings
        }
    });

    const response = {
        transaction: {
            success: true,
            transactionId: transactionId,
            totalAmount: totalEarnings
        }
    };

    let output = RichFormatter.header('Sale Complete', '✅');
    output += RichFormatter.keyValue({
        'Transaction ID': `\`${transactionId}\``,
        'Total Earnings': `${totalEarnings} gp`,
        'Items Sold': parsed.items.length
    });
    output += RichFormatter.success('Transaction completed successfully!');

    output += RichFormatter.embedJson(response, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleGetCharacterGold(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = TradingTools.GET_CHARACTER_GOLD.inputSchema.parse(args);

    const charResult = charRepo.findById(parsed.characterId);
    if (!charResult.success || !charResult.data) {
        throw new Error(charResult.error || `Character not found: ${parsed.characterId}`);
    }

    const gold = charResult.data.currency.gold;

    let output = RichFormatter.header('Character Gold', '💰');
    output += RichFormatter.keyValue({
        'Character': `\`${parsed.characterId}\``,
        'Gold': `${gold} gp`
    });

    output += RichFormatter.embedJson({ gold }, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

export async function handleUpdateCharacterGold(args: unknown, _ctx: SessionContext) {
    const { charRepo } = ensureDb();
    const parsed = TradingTools.UPDATE_CHARACTER_GOLD.inputSchema.parse(args);

    const updateResult = charRepo.update(parsed.characterId, {
        currency: { gold: parsed.goldAmount, silver: 0, copper: 0 }
    });

    if (!updateResult.success) {
        throw new Error(updateResult.error || 'Failed to update character gold');
    }

    let output = RichFormatter.header('Gold Updated', '💰');
    output += RichFormatter.keyValue({
        'Character': `\`${parsed.characterId}\``,
        'New Gold Amount': `${parsed.goldAmount} gp`
    });
    output += RichFormatter.success('Gold amount updated successfully.');

    output += RichFormatter.embedJson({ success: true }, 'STATE');

    return {
        content: [{
            type: 'text' as const,
            text: output
        }]
    };
}

// Helper function for disposition modifiers
function getDispositionModifier(disposition: number): number {
    if (disposition >= 50) return 0.8; // Helpful: 20% discount
    if (disposition >= 10) return 0.9; // Friendly: 10% discount
    if (disposition >= -9) return 1.0; // Neutral: no modifier
    if (disposition >= -49) return 1.2; // Unfriendly: 20% markup
    return 1.5; // Hostile: 50% markup
}