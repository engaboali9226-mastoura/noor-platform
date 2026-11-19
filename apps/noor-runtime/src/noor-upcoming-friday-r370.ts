import type {
    LocationProfileRepository, PrayerTimeCalculatorPort, PrayerTimePolicyRepository, TimeZonePort, TodayDashboard,
} from "@noor/personal";

/** Prefetch the real Friday schedule on Thursday so sharing can unlock at Asr without a reload. */
export async function resolveNoorUpcomingFriday(input: Readonly<{
    userId: string;
    now: string;
    today: Pick<TodayDashboard, "personalDay" | "islamicContext">;
    locations: LocationProfileRepository;
    prayerPolicies: PrayerTimePolicyRepository;
    calculator: PrayerTimeCalculatorPort;
    timeZone: TimeZonePort;
}>) {
    try {
        const {localDate, timeZone} = input.today.personalDay.boundary;
        if (input.timeZone.weekday(localDate) !== 4 ||
            input.timeZone.localDateForInstant(input.now, timeZone) !== localDate) return null;
        const friday = input.timeZone.addLocalDays(localDate, 1);
        const anchor = input.today.islamicContext.prayerTimes.nextFajr;
        if (input.timeZone.localDateForInstant(anchor, timeZone) !== friday) return null;

        const [location, policy] = await Promise.all([
            input.locations.getEffective(input.userId, anchor),
            input.prayerPolicies.getEffective(input.userId, anchor),
        ]);
        if (!location || location.userId !== input.userId || location.timeZone !== timeZone ||
            !policy || policy.userId !== input.userId) return null;

        const schedule = await input.calculator.calculate(location, policy, friday);
        if (schedule.localDate !== friday ||
            input.timeZone.localDateForInstant(schedule.sunrise, timeZone) !== friday ||
            input.timeZone.localDateForInstant(schedule.dhuhr, timeZone) !== friday ||
            !(Date.parse(schedule.sunrise) < Date.parse(schedule.dhuhr))) return null;

        return {localDate: friday, sunrise: schedule.sunrise, dhuhr: schedule.dhuhr, city: location.name};
    } catch {
        // A failed forecast never blocks the dashboard or substitutes Thursday's times.
        return null;
    }
}
