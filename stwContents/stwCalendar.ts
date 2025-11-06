// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwCalendar.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";

export class STWCalendar extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		let layout = this.getLayout(session);
		const mode = layout.settings.get("mode") || "month";
		const datetimeKey = layout.settings.get("key") || "date";
		const today = new Date(layout.settings.get("date") || Date.now());

		const fields = records.fields?.map(f => f.name) || Object.keys(records.rows?.[0] || {});
		if (!layout.hasTokens) {
			this.layout.set(session.lang, new STWLayout(layout.wbll + "lf".repeat(fields.length)));
			layout = this.getLayout(session);
		}

		const placeholders = new Map(session.placeholders);

		// Index records by date (day or hour)
		const recordMap: Record<string, any[]> = {};
		for (const row of records.rows || []) {
			const dt = row[datetimeKey] ? new Date(row[datetimeKey]) : null;
			if (!dt || isNaN(dt.getTime())) continue;
			let key = "";
			if (mode === "month" || mode === "week") {
				key = dt.toISOString().slice(0, 10); // YYYY-MM-DD
			} else if (mode === "day") {
				key = dt.toISOString().slice(0, 13); // YYYY-MM-DDTHH
			}
			if (!recordMap[key]) recordMap[key] = [];
			recordMap[key].push(row);
		}

		let body = "";
		if (mode === "week") {
			// Determine first day of week based on session language/locale
			const firstDayOfWeek = getFirstDayOfWeek(session);
			const weekStart = new Date(today);
			// Calculate offset from today to the first day of the week
			const offset = (today.getDay() - firstDayOfWeek + 7) % 7;
			weekStart.setDate(today.getDate() - offset);
			for (let i = 0; i < 7; i++) {
				const day = new Date(weekStart);
				day.setDate(weekStart.getDate() + i);
				const dateStr = day.toISOString().slice(0, 10);
				body += `<div class="stwCalendarGroup" data-group="${dateStr}"><div class="stwCalendarDayHeader">${dateStr}</div>`;
				for (const row of recordMap[dateStr] || []) {
					const rowPlaceholders = new Map(placeholders);
					for (const [name, value] of Object.entries(row))
						rowPlaceholders.set(`@@${name}`, String(value));
					body += await layout.render(request, session, fields, rowPlaceholders);
				}
				body += `</div>`;
			}
		} else if (mode === "day") {
			const dateStr = today.toISOString().slice(0, 10);
			for (let h = 0; h < 24; h++) {
				const hourStr = `${dateStr}T${String(h).padStart(2, "0")}`;
				body += `<div class="stwCalendarGroup" data-group="${hourStr}"><div class="stwCalendarHourHeader">${hourStr}:00</div>`;
				for (const row of recordMap[hourStr] || []) {
					const rowPlaceholders = new Map(placeholders);
					for (const [name, value] of Object.entries(row))
						rowPlaceholders.set(`@@${name}`, String(value));
					body += await layout.render(request, session, fields, rowPlaceholders);
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

			// Build week day headers starting from firstDayOfWeek
			const weekDays = [];
			const baseDate = new Date(2020, 5, 7); // Sunday
			for (let i = 0; i < 7; i++) {
				const day = new Date(baseDate);
				day.setDate(baseDate.getDate() + ((i + firstDayOfWeek) % 7));
				weekDays.push(day.toLocaleDateString(session.lang, { weekday: "short" }));
			}
			const monthName = today.toLocaleDateString(session.lang, { month: "long", year: "numeric" });

			body += `<div class="stwCalendarMonthHeader">${monthName}</div>`;
			body += `<table><thead><tr>`;
			for (const wd of weekDays) body += `<th>${wd}</th>`;
			body += `</tr></thead><tbody><tr>`;

			// Calculate the weekday index of the first day of the month (adjusted for firstDayOfWeek)
			const firstWeekday = (firstDay.getDay() - firstDayOfWeek + 7) % 7;

			// Fill initial empty cells
			for (let i = 0; i < firstWeekday; i++) body += `<td></td>`;

			for (let day = 1; day <= daysInMonth; day++) {
				const dateStr = toLocalDateString(new Date(year, month, day), session);
				const isToday = dateStr === toLocalDateString(new Date(), session);
				body += `<td${isToday ? ' class="stwCalendarToday"' : ''}><div class="stwCalendarDayNum">${day}</div>`;
				for (const row of recordMap[dateStr] || []) {
					const rowPlaceholders = new Map(placeholders);
					for (const [name, value] of Object.entries(row))
						rowPlaceholders.set(`@@${name}`, String(value));
					body += `<div>` + await layout.render(request, session, fields, rowPlaceholders) + `</div>`;
				}
				body += `</td>`;
				// If end of week, close row and start new
				if ((firstWeekday + day) % 7 === 0 && day !== daysInMonth)
					body += `</tr><tr>`;
			}

			// Fill trailing empty cells
			const trailing = (firstWeekday + daysInMonth) % 7;
			if (trailing !== 0) for (let i = trailing; i < 7; i++) body += `<td></td>`;
			body += `</tr></tbody></table>`;
		}
		return body;
	}
}

function getFirstDayOfWeek(session: STWSession): number {
	const sundayLocales = ["en-US", "en-CA", "en-AU", "en-PH", "zh-CN", "ja-JP"];
	if (sundayLocales.some(l => session.langs[0].startsWith(l.split("-")[0]))) return 0;
	return 1;
}

function toLocalDateString(date: Date, session: STWSession): string {
	const formatter = new Intl.DateTimeFormat(session.langs[0], {
		timeZone: session.tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	});
	const parts = formatter.formatToParts(date);
	const year = parts.find(p => p.type === "year")?.value;
	const month = parts.find(p => p.type === "month")?.value;
	const day = parts.find(p => p.type === "day")?.value;
	return `${year}-${month}-${day}`;
}

registerElement("Calendar", STWCalendar);
