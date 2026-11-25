import { strToU8, zipSync } from "fflate";

const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const docRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkgRel = "http://schemas.openxmlformats.org/package/2006/relationships";
const header = ["答卷编号", "提交时间（UTC）", "SL1", "P_A6", "作答耗时（秒）", "练习重试次数"];
function escapeXml(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
export function workbook(responses) {
  const rows = [header, ...responses].map((row, i) => {
    const cells = row.map((value, j) => {
      const address = String.fromCharCode(65 + j) + (i + 1);
      if (value === null) return `<c r="${address}"/>`;
      return typeof value === "number" ? `<c r="${address}"><v>${value}</v></c>` :
        `<c r="${address}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${i + 1}">${cells}</row>`;
  }).join("");
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${pkgRel}"><Relationship Id="rId1" Type="${docRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${sheetNs}" xmlns:r="${docRel}"><sheets><sheet name="问卷答卷" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkgRel}"><Relationship Id="rId1" Type="${docRel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${sheetNs}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="4" width="30" customWidth="1"/><col min="5" max="6" width="20" customWidth="1"/></cols><sheetData>${rows}</sheetData><autoFilter ref="A1:F${responses.length + 1}"/></worksheet>`
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])), { level: 1 });
}
