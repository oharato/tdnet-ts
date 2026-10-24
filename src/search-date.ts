/** Search dates are JST calendar days, or ISO timestamps with an explicit offset. */
export function searchDateBound(value: string, end: boolean): { iso: string; exclusive: boolean } {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    const parts = day ?? timestamp;
    const invalid = () => new Error(`Invalid search date: ${value}. Use YYYY-MM-DD (JST) or an ISO timestamp with timezone.`);
    if (!parts) throw invalid();

    // Date.parse normalizes some nonexistent dates, so validate the calendar first.
    const calendar = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00.000Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw invalid();
    }
    if (timestamp && (Number(timestamp[4]) > 23 || Number(timestamp[5]) > 59 || Number(timestamp[6]) > 59)) {
        throw invalid();
    }
    const milliseconds = Date.parse(day ? `${value}T00:00:00+09:00` : value);
    if (!Number.isFinite(milliseconds)) throw invalid();
    const iso = new Date(milliseconds + (day && end ? 86_400_000 : 0)).toISOString();
    if (!/^\d{4}-/.test(iso)) throw invalid();
    return {
        iso,
        exclusive: Boolean(day && end),
    };
}
