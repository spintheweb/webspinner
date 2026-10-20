// SPDX-License-Identifier: GPL-3.0-or-later
// Test suite: wbll.test

import { STWLayout } from "../stwComponents/stwWBLL.ts";

const Placeholders = new Map<string, string>([
	["@session", "123"],
	["@email", "john.doe@email.com"],
]);

const Records = {
	affectedRows: 3,
	fields: ["nome", "altezza", "dataDiNascita", "sesso", "usr"],
	rows: [
		{ nome: "Giancarlo Trevisan", altezza: 1.83, dataDiNascita: "1964-03-11", sesso: "M", "usr": "gtrevisan" },
		{ nome: "Mario Rossi", altezza: 1.78, dataDiNascita: "1985-04-12", sesso: "", "usr": "mario" },
		//		{ nome: "Luca Bianchi", altezza: 1.82, dataDiNascita: "1990-09-23", sesso: "M", "usr": "luca" },
	]
};

const Layout = `
l('Utente')e(';;;Ciao;Come;Stai')<\\n
\\s('caption="@@nome"')
\\A('title="@@nome"')\\tf\\tf\\tf<<<\\t
k('pluto;Amico di ')
a('https://www.google.com/search')p('q;@@nome')i('https://www.keyvisions.it/wp-content/uploads/2025/07/Giancarlo20250727bw-300x300.jpg') //e\\t //v(';;Search for @@nome in google')\\t
v(';;<b style="color:lightgreen">@@pluto @@usr</b>')\\a('onclick="foo()"')\\n
l('Nome')et('Inserisci il tuo nome')\\a('class="info"')
l('Altezza')e
l('Data di Nascita')e('date')\\t
h // Comment
<u
<n('2;M;Indeed you are a male;F;Female;;N.D.')// \\a('style="color:red"')\\n
j('function foo() { alert("Hello, {@@nome}!"); }')
<l('Sesso D')D(';;2;M;Maschio;F;Femmina;;N.D.')\\a('style="color:blue"')\\n
<l('Sesso d')d(';;2;M;Maschio;F;Femmina;;N.D.')
<l('Sesso S')S(';;2;M;Maschio;F;Femmina;;N.D.')
<l('Sesso s')s(';;2;M;Maschio;F;Femmina;;N.D.')
<l('Sesso r')r(';;2;M;Maschio;F;Femmina;;N.D.')
<l('Sesso c')c(';;2;M;Maschio;F;Femmina;;N.D.')
l('Note')m//\\a('style="width:100%"')\\n
l('Presente')c\\n
b(';stwSearch')t('Search')
j('function foo2() { alert("Salvataggio completato!"); }')
l('Progress [0, 1]')x('0.5')\\a('style="color:AccentColor; background-color:GrayText;min-width:10rem"')\\n // AccentColor, Highlight, GrayText, Canvas, CanvasText
`;

Deno.test("examples", async () => {
	let log = `<h1>WBLL tests: ${new Date().toISOString()}</h1>\n`;

	try {
		log += `<dl>
			<dt>WBLL</dt>
			<dd><textarea id="wbll" readonly>${Layout}</textarea></dd>`;

		const layout = new STWLayout(Layout);

		let html, render: { settings: Map<string, string | boolean | number>, HTML: string } = { settings: new Map(), HTML: '' };
		const placeholders = new Map(Placeholders);
		for (let i = 0; i < Records.rows.length; i++) {
			html = "";
			for (const [name, value] of Object.entries(Records.rows[i]))
				placeholders.set(`@@${name}`, String(value || ''));
			log += `<dt>Placeholders</dt><dd>`
			for (const [key, value] of placeholders)
				log += `${key}=${value || ""}, `;

			const timer = performance.now();
			render = await layout.render(
				Records.fields,
				placeholders,
				{ baseurl: "file:///D:/Projects/spintheweb/webspinner/tests/wbll.test.html", lang: "en", tz: "UTC" },
				'li'
			);
			const elapsed = performance.now() - timer;

			// Handle settings that may have been set during rendering, such as scripts
			if (!i && render.settings.get('script'))
				html += `<script defer>${render.settings.get('script')}</script>`;
			html += render.HTML;

			log += `<dt>Render Time</dt><dd>${elapsed.toFixed(2)} ms</dd>`;

			log += `<dt>HTML</dt>
			<dd style="display:flex; flex-wrap:wrap;"><form>${html}</form></dd>
			</dl>`;
		}

	} catch (error) {
		log += `<dt>WBLL Syntax Error</dt><dd style="color:red">${error}</dd></dl>`;
	}
	await Deno.writeTextFile("./tests/wbll.test.html", `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>WBLL Tests</title>
	<style>
		body { font-family: sans-serif; }
		textarea { width: 100%; height: 100px; }
		dl { margin-bottom: 1rem; }
		dt { font-weight: bold; }
		dd { margin-left: 1rem; }
		label { font-weight: bold; font-size: smaller; display: inline-flex; flex-direction: column; padding: 0.5rem; }
		fieldset { border: none; margin: 0; padding: 0; display: flex;  }
		fieldset>label { font-weight: normal; font-size: inherit; display: inline-block; padding: 0 0.5rem 0 0; }
		.info { font-weight:normal; font-style:italic; }
	</style>
</head>
<body>
${log}
</body>
</html>`);
});
