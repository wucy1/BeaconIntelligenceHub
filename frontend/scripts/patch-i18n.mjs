import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '../src/i18n/locales');

const t = {
  de: {
    'map.err.markersLoad': 'Meldungen auf der Karte konnten nicht geladen werden: {{msg}}',
    'map.offline.footprintsSectionTitle': 'Gebäudegrundrisse',
    'map.offline.footprintsSectionSummary':
      'Einmal herunterladen — bleibt beim Verschieben sichtbar; „Aktualisieren“ zum Zusammenführen.',
    'map.offline.footprintsHelpTitle': 'Grundrisse herunterladen',
    'map.offline.footprintsHelpBody':
      'Karte verschieben, dann Footprints für die aktuelle Ansicht laden. Daten werden auf diesem Gerät für die gewählte Krise gespeichert und bleiben beim Verschieben sichtbar. Kein automatisches Laden vom Server. Erneut herunterladen zum Zusammenführen. Offline nur gespeicherte Footprints.',
    'map.offline.tilesSectionTitle': 'Offline-Karte ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'OSM-Kacheln im orangefarbenen Kasten für Offline-Nutzung speichern.',
    'map.offline.tilesHelpTitle': 'Offline-Karte herunterladen',
    'map.offline.tilesHelpBody':
      'Orangefarbener gestrichelter Kasten = Download-Bereich; Karte bei Bedarf zuerst verschieben. Speichert Zoom z14–z18 (Offline max. z18). Optional Footprints für den Kasten mit gewählter Krise. Außerhalb des Bereichs können graue Kacheln erscheinen — erneut herunterladen.',
    'ops.sessionExpired.message':
      'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.',
    'ops.sessionExpired.signInAgain': 'Erneut anmelden',
    'ops.buildings.centralHubTitle': 'Zentrale Footprint-Bibliothek (in Arbeit)',
    'ops.buildings.centralHubUnderConstruction':
      'In Entwicklung: Die Zentrale stellt offizielle Gebäude-Footprints pro Krise bereit. Crisis Leads hängen sie nur an die Karte — kein GeoJSON-Upload pro Krise nötig. Demo-Import und Datei-Upload unten bleiben zum Testen verfügbar.',
  },
  es: {
    'map.err.markersLoad': 'No se pudieron cargar los reportes en el mapa: {{msg}}',
    'map.offline.footprintsSectionTitle': 'Contornos de edificios',
    'map.offline.footprintsSectionSummary':
      'Descargue una vez; permanecen al mover el mapa. Pulse Actualizar para combinar una nueva vista.',
    'map.offline.footprintsHelpTitle': 'Descarga de contornos',
    'map.offline.footprintsHelpBody':
      'Mueva el mapa y descargue los contornos de la vista actual. Los datos se guardan en este dispositivo para la crisis seleccionada y siguen visibles al desplazarse. No hay carga automática desde el servidor. Descargue de nuevo para combinar actualizaciones. Sin conexión solo se muestran contornos guardados.',
    'map.offline.tilesSectionTitle': 'Mapa sin conexión ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'Guarde teselas OSM dentro del recuadro naranja para usar sin conexión.',
    'map.offline.tilesHelpTitle': 'Descarga de mapa sin conexión',
    'map.offline.tilesHelpBody':
      'Recuadro naranja discontinuo = área de descarga; mueva el mapa primero si hace falta. Guarda zoom z14–z18 (máx. z18 sin conexión). Opcionalmente incluya contornos del recuadro con una crisis seleccionada. Fuera del área pueden aparecer teselas grises — descargue de nuevo.',
    'ops.sessionExpired.message':
      'Su sesión ha caducado. Inicie sesión de nuevo para continuar.',
    'ops.sessionExpired.signInAgain': 'Iniciar sesión de nuevo',
    'ops.buildings.centralHubTitle': 'Biblioteca central de contornos (en construcción)',
    'ops.buildings.centralHubUnderConstruction':
      'En construcción: el equipo central publicará contornos oficiales por crisis. Los leads solo los vincularán al mapa, sin subir GeoJSON por crisis. La importación demo y la carga de archivos siguen disponibles para pruebas.',
  },
  fr: {
    'map.err.markersLoad': 'Impossible de charger les signalements sur la carte : {{msg}}',
    'map.offline.footprintsSectionTitle': 'Emprises des bâtiments',
    'map.offline.footprintsSectionSummary':
      'Téléchargez une fois ; restent visibles en déplaçant la carte. Appuyez sur Mettre à jour pour fusionner une nouvelle vue.',
    'map.offline.footprintsHelpTitle': 'Téléchargement des emprises',
    'map.offline.footprintsHelpBody':
      'Déplacez la carte, puis téléchargez les emprises de la vue actuelle. Les données sont stockées sur cet appareil pour la crise sélectionnée et restent visibles en panning. Aucun chargement automatique depuis le serveur. Téléchargez à nouveau pour fusionner. Hors ligne : emprises enregistrées uniquement.',
    'map.offline.tilesSectionTitle': 'Carte hors ligne ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'Enregistrez les tuiles OSM dans le cadre orange pour une utilisation hors ligne.',
    'map.offline.tilesHelpTitle': 'Téléchargement carte hors ligne',
    'map.offline.tilesHelpBody':
      'Cadre orange en pointillés = zone de téléchargement ; déplacez la carte d’abord si besoin. Enregistre les niveaux z14–z18 (max z18 hors ligne). Option d’inclure les emprises du cadre pour une crise sélectionnée. Hors zone, tuiles grises possibles — retéléchargez.',
    'ops.sessionExpired.message': 'Votre session a expiré. Reconnectez-vous pour continuer.',
    'ops.sessionExpired.signInAgain': 'Se reconnecter',
    'ops.buildings.centralHubTitle': 'Bibliothèque centrale d’emprises (en construction)',
    'ops.buildings.centralHubUnderConstruction':
      'En construction : le siège publiera des emprises officielles par crise. Les leads les attacheront à la carte sans téléverser de GeoJSON par crise. L’import démo et le téléversement ci-dessous restent disponibles pour les tests.',
  },
  pt: {
    'map.err.markersLoad': 'Não foi possível carregar os relatórios no mapa: {{msg}}',
    'map.offline.footprintsSectionTitle': 'Contornos de edifícios',
    'map.offline.footprintsSectionSummary':
      'Descarregue uma vez; mantêm-se visíveis ao mover o mapa. Toque em Atualizar para combinar uma nova vista.',
    'map.offline.footprintsHelpTitle': 'Descarregar contornos',
    'map.offline.footprintsHelpBody':
      'Mova o mapa e descarregue os contornos da vista atual. Os dados ficam neste dispositivo para a crise selecionada e permanecem visíveis ao deslocar. Sem carregamento automático do servidor. Descarregue novamente para combinar. Offline: apenas contornos guardados.',
    'map.offline.tilesSectionTitle': 'Mapa offline ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'Guarde mosaicos OSM dentro da caixa laranja para uso offline.',
    'map.offline.tilesHelpTitle': 'Descarregar mapa offline',
    'map.offline.tilesHelpBody':
      'Caixa laranja tracejada = área de descarga; mova o mapa primeiro se necessário. Guarda zoom z14–z18 (máx. z18 offline). Opcionalmente inclua contornos da caixa com crise selecionada. Fora da área podem aparecer mosaicos cinzentos — descarregue novamente.',
    'ops.sessionExpired.message':
      'A sua sessão expirou. Inicie sessão novamente para continuar.',
    'ops.sessionExpired.signInAgain': 'Iniciar sessão novamente',
    'ops.buildings.centralHubTitle': 'Biblioteca central de contornos (em construção)',
    'ops.buildings.centralHubUnderConstruction':
      'Em construção: a sede publicará contornos oficiais por crise. Os leads apenas os ligarão ao mapa, sem carregar GeoJSON por crise. A importação demo e o envio de ficheiros abaixo permanecem para testes.',
  },
  ru: {
    'map.err.markersLoad': 'Не удалось загрузить отчёты на карте: {{msg}}',
    'map.offline.footprintsSectionTitle': 'Контуры зданий',
    'map.offline.footprintsSectionSummary':
      'Скачайте один раз — контуры остаются при перемещении карты. «Обновить» объединяет новый вид.',
    'map.offline.footprintsHelpTitle': 'Загрузка контуров',
    'map.offline.footprintsHelpBody':
      'Сдвиньте карту и загрузите контуры текущего вида. Данные хранятся на устройстве для выбранного кризиса и остаются при перемещении. Автозагрузки с сервера нет. Повторная загрузка объединяет обновления. Офлайн — только сохранённые контуры.',
    'map.offline.tilesSectionTitle': 'Офлайн-карта ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'Сохраните тайлы OSM в оранжевой рамке для офлайн-использования.',
    'map.offline.tilesHelpTitle': 'Загрузка офлайн-карты',
    'map.offline.tilesHelpBody':
      'Оранжевая пунктирная рамка = область загрузки; при необходимости сначала сдвиньте карту. Сохраняет z14–z18 (офлайн макс. z18). Опционально контуры зданий для рамки при выбранном кризисе. Вне области возможны серые тайлы — загрузите снова.',
    'ops.sessionExpired.message': 'Сессия истекла. Войдите снова, чтобы продолжить.',
    'ops.sessionExpired.signInAgain': 'Войти снова',
    'ops.buildings.centralHubTitle': 'Центральная библиотека контуров (в разработке)',
    'ops.buildings.centralHubUnderConstruction':
      'В разработке: штаб будет публиковать официальные контуры зданий по кризисам. Лиды только подключат их к карте без загрузки GeoJSON. Демо-импорт и загрузка файлов ниже остаются для тестов.',
  },
  ar: {
    'map.err.markersLoad': 'تعذّر تحميل البلاغات على الخريطة: {{msg}}',
    'map.offline.footprintsSectionTitle': 'حدود المباني',
    'map.offline.footprintsSectionSummary':
      'نزّل مرة واحدة؛ تبقى ظاهرة عند تحريك الخريطة. اضغط «تحديث» لدمج منظر جديد.',
    'map.offline.footprintsHelpTitle': 'تنزيل الحدود',
    'map.offline.footprintsHelpBody':
      'حرّك الخريطة ثم نزّل حدود المنظر الحالي. تُخزَّن البيانات على هذا الجهاز للأزمة المختارة وتبقى عند التحريك. لا تحميل تلقائي من الخادم. التنزيل مجدداً يدمج التحديثات. دون اتصال: الحدود المحفوظة فقط.',
    'map.offline.tilesSectionTitle': 'خريطة دون اتصال ({{side}}×{{side}} km)',
    'map.offline.tilesSectionSummary':
      'احفظ بلاط OSM داخل المربع البرتقالي للاستخدام دون اتصال.',
    'map.offline.tilesHelpTitle': 'تنزيل الخريطة دون اتصال',
    'map.offline.tilesHelpBody':
      'المربع البرتقالي المتقطع = منطقة التنزيل؛ حرّك الخريطة أولاً إن لزم. يحفظ z14–z18 (أقصى z18 دون اتصال). اختيارياً حدود المباني للمربع مع أزمة محددة. خارج المنطقة قد تظهر بلاط رمادي — أعد التنزيل.',
    'ops.sessionExpired.message': 'انتهت جلسة تسجيل الدخول. سجّل الدخول مجدداً للمتابعة.',
    'ops.sessionExpired.signInAgain': 'تسجيل الدخول مجدداً',
    'ops.buildings.centralHubTitle': 'مكتبة الحدود المركزية (قيد الإنشاء)',
    'ops.buildings.centralHubUnderConstruction':
      'قيد الإنشاء: ستنشر الإدارة المركزية حدود مبانٍ رسمية لكل أزمة. يكتفي قادة الأزمات بربطها بالخريطة دون رفع GeoJSON لكل أزمة. الاستيراد التجريبي والرفع أدناه يبقيان للاختبار.',
  },
  zh: {
    'map.err.markersLoad': '无法载入地图回报：{{msg}}',
    'map.offline.footprintsSectionTitle': '建筑物轮廓',
    'map.offline.footprintsSectionSummary':
      '下载一次后固定显示；平移地图不会消失，可按「更新」合并新视野。',
    'map.offline.footprintsHelpTitle': '建筑物轮廓说明',
    'map.offline.footprintsHelpBody':
      '先拖曳地图对准区域，再下载目前画面内的轮廓。资料储存于本机，同一危机下平移仍会显示；不会自动向服务器载入。再次下载会合并更新。离线时仅显示已储存内容。',
    'map.offline.tilesSectionTitle': '离线地图（{{side}}×{{side}} km）',
    'map.offline.tilesSectionSummary': '储存橙色框内的 OSM 瓦片，供离线平移使用。',
    'map.offline.tilesHelpTitle': '离线地图说明',
    'map.offline.tilesHelpBody':
      '橙色虚线框＝下载范围；可先移动地图再下载。储存 z14–z18 瓦片；离线最高 z18。可选一并储存框内建筑物 footprint（需选定危机）。移出已下载范围可能灰屏，请重新下载。',
    'ops.sessionExpired.message': '登录会话已过期，请重新登录以继续作业。',
    'ops.sessionExpired.signInAgain': '重新登录',
    'ops.buildings.centralHubTitle': '总部统一建筑物轮廓（建置中）',
    'ops.buildings.centralHubUnderConstruction':
      '此功能建置中：日后由总部团队统一维护各危机建筑物 footprint，危机 lead 仅需挂载至地图，无需各自上传 GeoJSON。下方示范导入与文件上传仍供测试使用。',
  },
};

const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));

for (const locale of Object.keys(t)) {
  const file = path.join(dir, `${locale}.json`);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(j, t[locale]);
  const sorted = Object.fromEntries(Object.keys(j).sort().map((k) => [k, j[k]]));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log('updated', locale);
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const missing = Object.keys(en).filter((k) => !(k in j));
  if (missing.length) {
    console.error('STILL missing in', f, missing.length, missing.slice(0, 5));
    process.exitCode = 1;
  }
}

console.log('all locales match en.json key count');
