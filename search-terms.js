// Los datos del Excel están en inglés y la gente busca en español, francés o italiano.
// Cada búsqueda se amplía con su traducción: «cacahuete», «arachide» o «arachidi» también encuentran «peanut».
// Para añadir una palabra: clave sin tildes y en minúsculas → términos en inglés.
const ES = {
  // Ingredientes
  cacahuete: ['peanut', 'groundnut'], cacahuetes: ['peanut', 'groundnut'], mani: ['peanut', 'groundnut'],
  sorgo: ['sorghum'], soja: ['soy'], leche: ['milk'], garbanzo: ['chickpea'], garbanzos: ['chickpea'],
  arroz: ['rice'], maiz: ['maize', 'corn'], mijo: ['millet'], lenteja: ['lentil'], lentejas: ['lentil'],
  judia: ['bean'], judias: ['bean'], frijol: ['bean'], frijoles: ['bean'], alubia: ['bean'], alubias: ['bean'],
  sesamo: ['sesame'], azucar: ['sugar'], aceite: ['oil'], suero: ['whey'], pescado: ['fish'], huevo: ['egg'],
  trigo: ['wheat'], avena: ['oat'], cebada: ['barley'], guisante: ['pea'], guisantes: ['pea'], girasol: ['sunflower'],
  palma: ['palm'], platano: ['banana'], vitamina: ['vitamin'], vitaminas: ['vitamin'], hierro: ['iron'],
  vegano: ['vegan'], vegetariano: ['vegetarian'],
  // Países
  kenia: ['kenya'], etiopia: ['ethiopia'], sudafrica: ['south africa'], francia: ['france'],
  'estados unidos': ['united states', 'usa'], eeuu: ['united states', 'usa'], haiti: ['haiti'],
  camerun: ['cameroon'], malaui: ['malawi'], sudan: ['sudan'], 'sudan del sur': ['south sudan'],
  pakistan: ['pakistan'], banglades: ['bangladesh'], afganistan: ['afghanistan'], mali: ['mali'],
  'costa de marfil': ["cote d'ivoire", "côte d'ivoire", 'ivory coast'], 'sierra leona': ['sierra leone'],
  'republica democratica del congo': ['congo'], congo: ['congo'], belgica: ['belgium'], dinamarca: ['denmark'],
  noruega: ['norway'], alemania: ['germany'], italia: ['italy'], 'reino unido': ['united kingdom', 'uk'],
  filipinas: ['philippines'], camboya: ['cambodia'], tailandia: ['thailand'], brasil: ['brazil'],
  mexico: ['mexico'], peru: ['peru'], egipto: ['egypt'], marruecos: ['morocco'], zimbabue: ['zimbabwe'],
  ruanda: ['rwanda'], yibuti: ['djibouti'], niger: ['niger'], nigeria: ['nigeria'], india: ['india'],
};

const FR = {
  // Ingrédients
  arachide: ['peanut', 'groundnut'], arachides: ['peanut', 'groundnut'], cacahuete: ['peanut', 'groundnut'], cacahuetes: ['peanut', 'groundnut'],
  sorgho: ['sorghum'], lait: ['milk'], 'pois chiche': ['chickpea'], 'pois chiches': ['chickpea'], riz: ['rice'],
  mais: ['maize', 'corn'], mil: ['millet'], lentille: ['lentil'], lentilles: ['lentil'], haricot: ['bean'], haricots: ['bean'],
  sucre: ['sugar'], huile: ['oil'], lactoserum: ['whey'], poisson: ['fish'], oeuf: ['egg'], 'œuf': ['egg'], oeufs: ['egg'],
  ble: ['wheat'], avoine: ['oat'], orge: ['barley'], pois: ['pea'], tournesol: ['sunflower'], palme: ['palm'],
  banane: ['banana'], vitamine: ['vitamin'], vitamines: ['vitamin'], fer: ['iron'],
  vegan: ['vegan'], vegetalien: ['vegan'], vegetarien: ['vegetarian'],
  // Pays
  ethiopie: ['ethiopia'], 'afrique du sud': ['south africa'], 'etats-unis': ['united states', 'usa'], 'etats unis': ['united states', 'usa'],
  cameroun: ['cameroon'], soudan: ['sudan'], 'soudan du sud': ['south sudan'], "cote d'ivoire": ["cote d'ivoire", "côte d'ivoire", 'ivory coast'],
  'republique democratique du congo': ['congo'], belgique: ['belgium'], danemark: ['denmark'], norvege: ['norway'],
  allemagne: ['germany'], italie: ['italy'], 'royaume-uni': ['united kingdom', 'uk'], 'royaume uni': ['united kingdom', 'uk'],
  cambodge: ['cambodia'], thailande: ['thailand'], bresil: ['brazil'], mexique: ['mexico'], perou: ['peru'],
  egypte: ['egypt'], maroc: ['morocco'], inde: ['india'],
};

const IT = {
  // Ingredienti
  arachidi: ['peanut', 'groundnut'], noccioline: ['peanut', 'groundnut'], soia: ['soy'], latte: ['milk'],
  cece: ['chickpea'], ceci: ['chickpea'], riso: ['rice'], miglio: ['millet'], lenticchia: ['lentil'], lenticchie: ['lentil'],
  fagiolo: ['bean'], fagioli: ['bean'], zucchero: ['sugar'], olio: ['oil'], 'siero di latte': ['whey'], siero: ['whey'],
  pesce: ['fish'], uovo: ['egg'], uova: ['egg'], grano: ['wheat'], frumento: ['wheat'], orzo: ['barley'],
  pisello: ['pea'], piselli: ['pea'], girasole: ['sunflower'], ferro: ['iron'],
  // Paesi
  'stati uniti': ['united states', 'usa'], 'sud sudan': ['south sudan'], "costa d'avorio": ["cote d'ivoire", "côte d'ivoire", 'ivory coast'],
  'repubblica democratica del congo': ['congo'], belgio: ['belgium'], danimarca: ['denmark'], norvegia: ['norway'],
  germania: ['germany'], 'regno unito': ['united kingdom', 'uk'], filippine: ['philippines'], cambogia: ['cambodia'],
  thailandia: ['thailand'], brasile: ['brazil'], messico: ['mexico'], egitto: ['egypt'], marocco: ['morocco'], gibuti: ['djibouti'],
};

// Si una palabra existe en varios idiomas, se juntan sus traducciones.
const TERMS = {};
for (const map of [ES, FR, IT]) {
  for (const [key, terms] of Object.entries(map)) TERMS[key] = [...new Set([...(TERMS[key] || []), ...terms])];
}

const plain = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'").toLowerCase().trim();

// Devuelve la búsqueda original más sus traducciones, sin repetir.
function expandSearch(search) {
  const term = String(search || '').trim();
  if (!term) return [];
  return [...new Set([term, ...(TERMS[plain(term)] || [])])];
}

module.exports = { expandSearch };
