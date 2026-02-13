import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ── Enums (stored as text in SQLite) ──────────────────────────────────────────

export const DEVICE_TYPES = ['speaker', 'headphones'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const CONNECTION_TYPES = ['wired', 'bluetooth', 'wifi', 'ir'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const PRICE_TIERS = ['budget', 'mid', 'premium', 'flagship'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

export const CODECS = ['flac', 'opus', 'mp3', 'aac'] as const;
export type Codec = (typeof CODECS)[number];

export const SELECTED_OPTIONS = ['a', 'b', 'neither'] as const;
export type SelectedOption = (typeof SELECTED_OPTIONS)[number];

export const PAIRING_TYPES = ['same_song', 'different_song', 'placebo'] as const;
export type PairingType = (typeof PAIRING_TYPES)[number];

export const TRANSITION_MODES = ['gapless', 'gap_continue', 'gap_restart'] as const;
export type TransitionMode = (typeof TRANSITION_MODES)[number];

// ── Tables ────────────────────────────────────────────────────────────────────

export const listeningDevices = sqliteTable('listening_devices', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	modifiedAt: integer('modified_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	approvedAt: integer('approved_at', { mode: 'timestamp' }),
	approvedBy: text('approved_by'),
	deviceType: text('device_type', { enum: DEVICE_TYPES }).notNull(),
	connectionType: text('connection_type', { enum: CONNECTION_TYPES }).notNull(),
	brand: text('brand').notNull(),
	model: text('model').notNull(),
	priceTier: text('price_tier', { enum: PRICE_TIERS }).notNull()
});

export const sourceFiles = sqliteTable('source_files', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	r2Key: text('r2_key').notNull(),
	uploadedAt: integer('uploaded_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	licenseUrl: text('license_url').notNull(),
	approvedAt: integer('approved_at', { mode: 'timestamp' }),
	approvedBy: text('approved_by'),
	title: text('title').notNull(),
	streamUrl: text('stream_url'),
	artist: text('artist'),
	artistUrl: text('artist_url'),
	genre: text('genre'),
	duration: integer('duration').notNull() // total duration in ms
});

export const qualityOptions = sqliteTable(
	'quality_options',
	{
		codec: text('codec', { enum: CODECS }).notNull(),
		bitrate: integer('bitrate').notNull(), // kbps, 0 for flac/lossless
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
	},
	(table) => [primaryKey({ columns: [table.codec, table.bitrate] })]
);

export const candidateFiles = sqliteTable('candidate_files', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	r2Key: text('r2_key').notNull(),
	codec: text('codec', { enum: CODECS }).notNull(),
	bitrate: integer('bitrate').notNull(),
	sourceFileId: text('source_file_id')
		.notNull()
		.references(() => sourceFiles.id)
});

export const ephemeralStreamUrls = sqliteTable('ephemeral_stream_urls', {
	token: text('token')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	candidateFileId: text('candidate_file_id')
		.notNull()
		.references(() => candidateFiles.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const answers = sqliteTable('answers', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	deviceId: text('device_id')
		.notNull()
		.references(() => listeningDevices.id),
	candidateAId: text('candidate_a_id')
		.notNull()
		.references(() => candidateFiles.id),
	candidateBId: text('candidate_b_id')
		.notNull()
		.references(() => candidateFiles.id),
	selected: text('selected', { enum: SELECTED_OPTIONS }).notNull(),
	pairingType: text('pairing_type', { enum: PAIRING_TYPES }).notNull(),
	transitionMode: text('transition_mode', { enum: TRANSITION_MODES }).notNull(),
	startTime: integer('start_time').notNull(), // segment start in ms
	segmentDuration: integer('segment_duration').notNull(), // segment length in ms
	responseTime: integer('response_time') // time spent deciding in ms
});

export const resultSnapshots = sqliteTable('result_snapshots', {
	createdAt: integer('created_at', { mode: 'timestamp' })
		.primaryKey()
		.$defaultFn(() => new Date()),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	totalResponses: integer('total_responses').notNull(),
	insights: text('insights', { mode: 'json' }).$type<Record<string, unknown>>()
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const sourceFilesRelations = relations(sourceFiles, ({ many }) => ({
	candidates: many(candidateFiles)
}));

export const candidateFilesRelations = relations(candidateFiles, ({ one, many }) => ({
	sourceFile: one(sourceFiles, {
		fields: [candidateFiles.sourceFileId],
		references: [sourceFiles.id]
	}),
	qualityOption: one(qualityOptions, {
		fields: [candidateFiles.codec, candidateFiles.bitrate],
		references: [qualityOptions.codec, qualityOptions.bitrate]
	}),
	ephemeralUrls: many(ephemeralStreamUrls)
}));

export const ephemeralStreamUrlsRelations = relations(ephemeralStreamUrls, ({ one }) => ({
	candidateFile: one(candidateFiles, {
		fields: [ephemeralStreamUrls.candidateFileId],
		references: [candidateFiles.id]
	})
}));

export const answersRelations = relations(answers, ({ one }) => ({
	device: one(listeningDevices, {
		fields: [answers.deviceId],
		references: [listeningDevices.id]
	}),
	candidateA: one(candidateFiles, {
		fields: [answers.candidateAId],
		references: [candidateFiles.id],
		relationName: 'candidateA'
	}),
	candidateB: one(candidateFiles, {
		fields: [answers.candidateBId],
		references: [candidateFiles.id],
		relationName: 'candidateB'
	})
}));

export const listeningDevicesRelations = relations(listeningDevices, ({ many }) => ({
	answers: many(answers)
}));

export const qualityOptionsRelations = relations(qualityOptions, ({ many }) => ({
	candidates: many(candidateFiles)
}));
