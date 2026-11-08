/**
 * @fileoverview Defines the calendar content element.
 *
 * Groups datasource records by date and renders calendar views using the
 * configured layout and localized session context.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwCalendar
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWCalendar extends STWContent {
	constructor(content) {
		super(content);
	}

	async render(_request, session, records) {
		const fields = records.fields;
		const firstRow = records.rows[0];
		const firstPlaceholders = new Map(session.placeholders);
		if (firstRow)
			for (const [name, value] of Object.entries(firstRow))
				firstPlaceholders.set(`@@${name}`, String(value));
		const layout = this.getLayout(session, "lf\\r".repeat(fields.length));
		const firstRender = await layout.render(fields, firstPlaceholders, session);
		const settings = firstRender.settings;
		const mode = String(settings.get("mode") ?? "month");
		const datetimeKey = String(settings.get("key") ?? "date");
		
		let today = new Date(String(settings.get("date")));
		if (isNaN(today.getTime())) today = new Date();
		const renderRow = async (row) => {
			if (row === firstRow)
				return firstRender.HTML;
			const rowPlaceholders = new Map(session.placeholders);
			for (const [name, value] of Object.entries(row))
				rowPlaceholders.set(`@@${name}`, String(value));
			return (await layout.render(fields, rowPlaceholders, session)).HTML;
		};

		const recordMap = {};
		for (const row of records.rows || []) {
			const dt = row[datetimeKey] ? new Date(row[datetimeKey]) : null;
			if (!dt || isNaN(dt.getTime())) continue;
			let key = "";
			if (mode === "month" || mode === "week") {
				key = dt.toISOString().slice(0, 10);
			} else if (mode === "day") {
				key = dt.toISOString().slice(0, 13);
			}
			if (!recordMap[key]) recordMap[key] = [];
			recordMap[key].push(row);
		}
		
		let body = "";
		if (mode === "week") {
			const firstDayOfWeek = getFirstDayOfWeek(session);
			const weekStart = new Date(today);
			const offset = (today.getDay() - firstDayOfWeek + 7) % 7;
			weekStart.setDate(today.getDate() - offset);
			for (let i = 0; i < 7; i++) {
				const day = new Date(weekStart);
				day.setDate(weekStart.getDate() + i);
				const dateStr = day.toISOString().slice(0, 10);
				body += `<div class="stwCalendarGroup" data-group="${dateStr}"><div class="stwCalendarDayHeader">${dateStr}</div>`;
				for (const row of recordMap[dateStr] || []) {
					body += await renderRow(row);
				}
				body += `</div>`;
			}
		} else if (mode === "day") {
			const dateStr = today.toISOString().slice(0, 10);
			for (let h = 0; h < 24; h++) {
				const hourStr = `${dateStr}T${String(h).padStart(2, "0")}`;
				body += `<div class="stwCalendarGroup" data-group="${hourStr}"><div class="stwCalendarHourHeader">${hourStr}:00</div>`;
				for (const row of recordMap[hourStr] || []) {
					body += await renderRow(row);
				}
				body += `</div>`;
			}
		} else {
			const year = today.getFullYear();
			const month = today.getMonth();
			const firstDay = new Date(year, month, 1);
			const lastDay = new Date(year, month + 1, 0);
			const daysInMonth = lastDay.getDate();
			const firstDayOfWeek = getFirstDayOfWeek(session);
			const weekDays = [];
			const locale = session.lang || "en";
			for (let i = 0; i < 7; i++) {
				const day = new Date(Date.UTC(2023, 0, 1 + (i + firstDayOfWeek) % 7));
				weekDays.push(day.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }));
			}
			const monthName = today.toLocaleDateString(session.lang, { month: "long", year: "numeric" });
			body += `<div class="stwCalendarMonthHeader">${monthName}</div>`;
			body += `<table><thead><tr>`;
			for (const wd of weekDays) body += `<th>${wd}</th>`;
			body += `</tr></thead><tbody><tr>`;
			const firstWeekday = (firstDay.getDay() - firstDayOfWeek + 7) % 7;
			for (let i = 0; i < firstWeekday; i++) body += `<td></td>`;
			for (let day = 1; day <= daysInMonth; day++) {
				const dateStr = toLocalDateString(new Date(year, month, day), session);
				const isToday = dateStr === toLocalDateString(new Date(), session);
				body += `<td${isToday ? ' class="stwCalendarToday"' : ""}><div class="stwCalendarDayNum">${day}</div>`;
				for (const row of recordMap[dateStr] || []) {
					body += `<div>` + await renderRow(row) + `</div>`;
				}
				body += `</td>`;
				if ((firstWeekday + day) % 7 === 0 && day !== daysInMonth)
					body += `</tr><tr>`;
			}
			const trailing = (firstWeekday + daysInMonth) % 7;
			if (trailing !== 0) for (let i = trailing; i < 7; i++) body += `<td></td>`;
			body += `</tr></tbody></table>`;
		}
		return body;
	}
}

function getFirstDayOfWeek(session) {
	const locale = new Intl.Locale(session.langs?.[0] || session.lang || "en");
	const firstDay = locale.weekInfo?.firstDay ?? locale.getWeekInfo?.().firstDay;
	if (firstDay) return firstDay % 7;
	const sundayRegions = new Set(["CA", "IL", "JP", "MX", "PH", "US"]);
	return sundayRegions.has(locale.region) ? 0 : 1;
}

function toLocalDateString(date, session) {
	const formatter = new Intl.DateTimeFormat(session.langs[0], {
		timeZone: session.tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	});
	const parts = formatter.formatToParts(date);
	const year = parts.find((p) => p.type === "year")?.value;
	const month = parts.find((p) => p.type === "month")?.value;
	const day = parts.find((p) => p.type === "day")?.value;
	return `${year}-${month}-${day}`;
}

registerElement("Calendar", STWCalendar);

export {
	STWCalendar
};
