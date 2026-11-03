// Iconos de trazo, 24x24, que heredan el color del texto.

const svg = (trazos, clase = "") =>
  `<svg class="${clase}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${trazos}</svg>`;

const TRAZOS = {
  compartir: '<path d="M12 3.5v11"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M5 13.5v4.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V13.5"/>',
  copiar: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.25A2.25 2.25 0 0 0 13.25 4h-7A2.25 2.25 0 0 0 4 6.25v7a2.25 2.25 0 0 0 2.25 2.25H8.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  enlace: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  externo: '<path d="M7.5 16.5 16.5 7.5"/><path d="M9 7.5h7.5V15"/>',
  mensaje: '<path d="M20 11.5a7.5 7.5 0 0 1-11.06 6.6L4.5 19.5l1.4-4.3A7.5 7.5 0 1 1 20 11.5Z"/>',
  maletin: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3.5 12.5h17"/>',
  atras: '<path d="M19 12H5.5"/><path d="m11 6.5-5.5 5.5 5.5 5.5"/>',
};

export const icono = (nombre, clase = "icono") => svg(TRAZOS[nombre], clase);

// Dos iconos superpuestos para animar el cambio (por ejemplo copiar y check)
export const iconoCambio = (antes, despues) =>
  `<span class="icono-cambio">${svg(TRAZOS[antes], "icono-antes")}${svg(TRAZOS[despues], "icono-despues")}</span>`;
