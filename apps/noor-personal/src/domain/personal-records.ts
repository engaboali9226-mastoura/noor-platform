import type {
    PersonalHistoricalEvent,
    PersonalNotificationHistoryEntry,
    PersonalProfile,
} from "./model.js";

function instant(value: unknown): value is string {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function localDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validPersonalProfile(value: unknown): value is PersonalProfile {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const avatar = row.avatarUrl;
    const avatarOk = avatar === null || (typeof avatar === "string" && avatar.length <= 2048 && (avatar.startsWith("/") || (() => {
        try { return new URL(avatar).protocol === "https:"; } catch { return false; }
    })()));
    return Object.keys(row).sort().join(",") === "avatarUrl,birthDate,displayName,updatedAt,userId"
        && typeof row.userId === "string" && row.userId.length > 0 && row.userId.length <= 256
        && typeof row.displayName === "string" && row.displayName.trim().length > 0 && row.displayName.length <= 120
        && avatarOk
        && (row.birthDate === null || localDate(row.birthDate))
        && instant(row.updatedAt);
}

export function validPersonalHistoricalEvent(value: unknown): value is PersonalHistoricalEvent {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    const dateOk = row.calendar === "gregorian"
        ? Number.isInteger(row.month) && Number(row.month) >= 1 && Number(row.month) <= 12
            && Number.isInteger(row.day) && Number(row.day) >= 1 && Number(row.day) <= 31
            && (row.year === null || Number.isInteger(row.year) && Number(row.year) >= 1 && Number(row.year) <= 9999)
            && localDate(`${String(row.year ?? 2000).padStart(4, "0")}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`)
        : row.calendar === "hijri"
            && Number.isInteger(row.month) && Number(row.month) >= 1 && Number(row.month) <= 12
            && Number.isInteger(row.day) && Number(row.day) >= 1 && Number(row.day) <= 30
            && (row.year === null || Number.isInteger(row.year) && Number(row.year) >= 1 && Number(row.year) <= 20000);
    return Object.keys(row).sort().join(",") === "calendar,createdAt,day,details,enabled,id,month,source,title,updatedAt,userId,year"
        && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 256
        && typeof row.userId === "string" && row.userId.length > 0 && row.userId.length <= 256
        && dateOk
        && typeof row.title === "string" && row.title.trim().length > 0 && row.title.length <= 160
        && typeof row.details === "string" && row.details.length <= 2000
        && typeof row.source === "string" && row.source.length <= 500
        && typeof row.enabled === "boolean"
        && instant(row.createdAt) && instant(row.updatedAt);
}

export function validPersonalNotificationHistoryEntry(value: unknown): value is PersonalNotificationHistoryEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return Object.keys(row).sort().join(",") === "id,kind,occurredAt,readAt,scheduledFor,targetId,title,userId"
        && typeof row.id === "string" && row.id.length > 0 && row.id.length <= 256
        && typeof row.userId === "string" && row.userId.length > 0 && row.userId.length <= 256
        && (row.kind === "reminder" || row.kind === "appointment")
        && typeof row.title === "string" && row.title.trim().length > 0 && row.title.length <= 200
        && typeof row.targetId === "string" && row.targetId.length > 0 && row.targetId.length <= 256
        && instant(row.scheduledFor) && instant(row.occurredAt)
        && (row.readAt === null || instant(row.readAt));
}
