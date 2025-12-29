/**
 * Lore Repository - Stores world lore entries, cultures, factions, and NPC backgrounds
 */

import { Database } from 'better-sqlite3';
import { BaseRepository } from '../base.repo.js';

// Types for lore entities
export interface Culture {
  id: string;
  worldId: string;
  name: string;
  description: string;
  values: string[];
  customs: string[];
  languages: string[];
  religion: string | null;
  territory: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FactionDefinition {
  id: string;
  worldId: string;
  name: string;
  type: string;
  description: string;
  goals: string[];
  values: string[];
  resources: string[];
  territory: string | null;
  leaderNpcId: string | null;
  powerLevel: number;
  publicReputation: number;
  secretGoals: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoreEntry {
  id: string;
  worldId: string;
  type: string;
  title: string;
  content: string;
  era: string | null;
  isSecret: boolean;
  knownBy: string[] | null;
  relatedEntities: string[] | null;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface NPCBackground {
  id: string;
  npcId: string;
  worldId: string;
  cultureId: string | null;
  factionIds: string[] | null;
  backstory: string;
  personalityTraits: string[];
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  speakingStyle: string | null;
  knowledgeAreas: string[] | null;
  secrets: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// Row types for database
interface CultureRow {
  id: string;
  world_id: string;
  name: string;
  description: string;
  values: string;
  customs: string;
  languages: string;
  religion: string | null;
  territory: string | null;
  created_at: string;
  updated_at: string;
}

interface FactionRow {
  id: string;
  world_id: string;
  name: string;
  type: string;
  description: string;
  goals: string;
  values: string;
  resources: string;
  territory: string | null;
  leader_npc_id: string | null;
  power_level: number;
  public_reputation: number;
  secret_goals: string | null;
  created_at: string;
  updated_at: string;
}

interface LoreRow {
  id: string;
  world_id: string;
  type: string;
  title: string;
  content: string;
  era: string | null;
  is_secret: number;
  known_by: string | null;
  related_entities: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

interface NPCBackgroundRow {
  id: string;
  npc_id: string;
  world_id: string;
  culture_id: string | null;
  faction_ids: string | null;
  backstory: string;
  personality_traits: string;
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  speaking_style: string | null;
  knowledge_areas: string | null;
  secrets: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository for Culture entities
 */
export class CultureRepository extends BaseRepository<Culture> {
  constructor(db: Database) {
    super(db, 'cultures');
  }

  protected toEntity(row: unknown): Culture {
    const r = row as CultureRow;
    return {
      id: r.id,
      worldId: r.world_id,
      name: r.name,
      description: r.description,
      values: JSON.parse(r.values || '[]'),
      customs: JSON.parse(r.customs || '[]'),
      languages: JSON.parse(r.languages || '[]'),
      religion: r.religion,
      territory: r.territory,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  protected toRow(entity: Partial<Culture>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (entity.id !== undefined) row.id = entity.id;
    if (entity.worldId !== undefined) row.world_id = entity.worldId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.values !== undefined) row.values = JSON.stringify(entity.values);
    if (entity.customs !== undefined) row.customs = JSON.stringify(entity.customs);
    if (entity.languages !== undefined) row.languages = JSON.stringify(entity.languages);
    if (entity.religion !== undefined) row.religion = entity.religion;
    if (entity.territory !== undefined) row.territory = entity.territory;
    return row;
  }

  async findByWorld(worldId: string): Promise<Culture[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ?`);
    return (stmt.all(worldId) as CultureRow[]).map(r => this.toEntity(r));
  }

  async findByName(worldId: string, name: string): Promise<Culture | null> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND name = ?`);
    const row = stmt.get(worldId, name) as CultureRow | undefined;
    return row ? this.toEntity(row) : null;
  }
}

/**
 * Repository for Faction Definition entities
 */
export class FactionDefinitionRepository extends BaseRepository<FactionDefinition> {
  constructor(db: Database) {
    super(db, 'faction_definitions');
  }

  protected toEntity(row: unknown): FactionDefinition {
    const r = row as FactionRow;
    return {
      id: r.id,
      worldId: r.world_id,
      name: r.name,
      type: r.type,
      description: r.description,
      goals: JSON.parse(r.goals || '[]'),
      values: JSON.parse(r.values || '[]'),
      resources: JSON.parse(r.resources || '[]'),
      territory: r.territory,
      leaderNpcId: r.leader_npc_id,
      powerLevel: r.power_level,
      publicReputation: r.public_reputation,
      secretGoals: r.secret_goals ? JSON.parse(r.secret_goals) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  protected toRow(entity: Partial<FactionDefinition>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (entity.id !== undefined) row.id = entity.id;
    if (entity.worldId !== undefined) row.world_id = entity.worldId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.type !== undefined) row.type = entity.type;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.goals !== undefined) row.goals = JSON.stringify(entity.goals);
    if (entity.values !== undefined) row.values = JSON.stringify(entity.values);
    if (entity.resources !== undefined) row.resources = JSON.stringify(entity.resources);
    if (entity.territory !== undefined) row.territory = entity.territory;
    if (entity.leaderNpcId !== undefined) row.leader_npc_id = entity.leaderNpcId;
    if (entity.powerLevel !== undefined) row.power_level = entity.powerLevel;
    if (entity.publicReputation !== undefined) row.public_reputation = entity.publicReputation;
    if (entity.secretGoals !== undefined) row.secret_goals = entity.secretGoals ? JSON.stringify(entity.secretGoals) : null;
    return row;
  }

  async findByWorld(worldId: string): Promise<FactionDefinition[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ?`);
    return (stmt.all(worldId) as FactionRow[]).map(r => this.toEntity(r));
  }

  async findByType(worldId: string, type: string): Promise<FactionDefinition[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND type = ?`);
    return (stmt.all(worldId, type) as FactionRow[]).map(r => this.toEntity(r));
  }

  async findByName(worldId: string, name: string): Promise<FactionDefinition | null> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND name = ?`);
    const row = stmt.get(worldId, name) as FactionRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async updateReputation(id: string, reputation: number): Promise<void> {
    const stmt = this.db.prepare(`UPDATE ${this.tableName} SET public_reputation = ?, updated_at = datetime('now') WHERE id = ?`);
    stmt.run(reputation, id);
  }
}

/**
 * Repository for Lore Entry entities
 */
export class LoreEntryRepository extends BaseRepository<LoreEntry> {
  constructor(db: Database) {
    super(db, 'lore_entries');
  }

  protected toEntity(row: unknown): LoreEntry {
    const r = row as LoreRow;
    return {
      id: r.id,
      worldId: r.world_id,
      type: r.type,
      title: r.title,
      content: r.content,
      era: r.era,
      isSecret: r.is_secret === 1,
      knownBy: r.known_by ? JSON.parse(r.known_by) : null,
      relatedEntities: r.related_entities ? JSON.parse(r.related_entities) : null,
      tags: r.tags ? JSON.parse(r.tags) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  protected toRow(entity: Partial<LoreEntry>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (entity.id !== undefined) row.id = entity.id;
    if (entity.worldId !== undefined) row.world_id = entity.worldId;
    if (entity.type !== undefined) row.type = entity.type;
    if (entity.title !== undefined) row.title = entity.title;
    if (entity.content !== undefined) row.content = entity.content;
    if (entity.era !== undefined) row.era = entity.era;
    if (entity.isSecret !== undefined) row.is_secret = entity.isSecret ? 1 : 0;
    if (entity.knownBy !== undefined) row.known_by = entity.knownBy ? JSON.stringify(entity.knownBy) : null;
    if (entity.relatedEntities !== undefined) row.related_entities = entity.relatedEntities ? JSON.stringify(entity.relatedEntities) : null;
    if (entity.tags !== undefined) row.tags = entity.tags ? JSON.stringify(entity.tags) : null;
    return row;
  }

  async findByWorld(worldId: string): Promise<LoreEntry[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ?`);
    return (stmt.all(worldId) as LoreRow[]).map(r => this.toEntity(r));
  }

  async findByType(worldId: string, type: string): Promise<LoreEntry[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND type = ?`);
    return (stmt.all(worldId, type) as LoreRow[]).map(r => this.toEntity(r));
  }

  async findByEra(worldId: string, era: string): Promise<LoreEntry[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND era = ?`);
    return (stmt.all(worldId, era) as LoreRow[]).map(r => this.toEntity(r));
  }

  async findPublic(worldId: string): Promise<LoreEntry[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND is_secret = 0`);
    return (stmt.all(worldId) as LoreRow[]).map(r => this.toEntity(r));
  }

  async findSecrets(worldId: string): Promise<LoreEntry[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ? AND is_secret = 1`);
    return (stmt.all(worldId) as LoreRow[]).map(r => this.toEntity(r));
  }
}

/**
 * Repository for NPC Background entities
 */
export class NPCBackgroundRepository extends BaseRepository<NPCBackground> {
  constructor(db: Database) {
    super(db, 'npc_backgrounds');
  }

  protected toEntity(row: unknown): NPCBackground {
    const r = row as NPCBackgroundRow;
    return {
      id: r.id,
      npcId: r.npc_id,
      worldId: r.world_id,
      cultureId: r.culture_id,
      factionIds: r.faction_ids ? JSON.parse(r.faction_ids) : null,
      backstory: r.backstory,
      personalityTraits: JSON.parse(r.personality_traits || '[]'),
      ideals: r.ideals,
      bonds: r.bonds,
      flaws: r.flaws,
      speakingStyle: r.speaking_style,
      knowledgeAreas: r.knowledge_areas ? JSON.parse(r.knowledge_areas) : null,
      secrets: r.secrets ? JSON.parse(r.secrets) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  protected toRow(entity: Partial<NPCBackground>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (entity.id !== undefined) row.id = entity.id;
    if (entity.npcId !== undefined) row.npc_id = entity.npcId;
    if (entity.worldId !== undefined) row.world_id = entity.worldId;
    if (entity.cultureId !== undefined) row.culture_id = entity.cultureId;
    if (entity.factionIds !== undefined) row.faction_ids = entity.factionIds ? JSON.stringify(entity.factionIds) : null;
    if (entity.backstory !== undefined) row.backstory = entity.backstory;
    if (entity.personalityTraits !== undefined) row.personality_traits = JSON.stringify(entity.personalityTraits);
    if (entity.ideals !== undefined) row.ideals = entity.ideals;
    if (entity.bonds !== undefined) row.bonds = entity.bonds;
    if (entity.flaws !== undefined) row.flaws = entity.flaws;
    if (entity.speakingStyle !== undefined) row.speaking_style = entity.speakingStyle;
    if (entity.knowledgeAreas !== undefined) row.knowledge_areas = entity.knowledgeAreas ? JSON.stringify(entity.knowledgeAreas) : null;
    if (entity.secrets !== undefined) row.secrets = entity.secrets ? JSON.stringify(entity.secrets) : null;
    return row;
  }

  async findByNPC(npcId: string): Promise<NPCBackground | null> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE npc_id = ?`);
    const row = stmt.get(npcId) as NPCBackgroundRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async findByWorld(worldId: string): Promise<NPCBackground[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE world_id = ?`);
    return (stmt.all(worldId) as NPCBackgroundRow[]).map(r => this.toEntity(r));
  }

  async findByCulture(cultureId: string): Promise<NPCBackground[]> {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE culture_id = ?`);
    return (stmt.all(cultureId) as NPCBackgroundRow[]).map(r => this.toEntity(r));
  }
}
