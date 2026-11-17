// 15 項細胞構造的介紹文字：id 與文字的唯一來源。
// 注意：本檔不可 import forbidden-words.js（那個檔只給測試用）。

export const INTRO = {
  title: '植物細胞',
  paragraphs: [
    '眼前是一個葉肉細胞，位在葉片裡，負責行光合作用。',
    '和動物細胞相比，成熟植物細胞最明顯的差別是有細胞壁和大型的中央液泡。',
    '許多植物細胞還有葉綠體，但不是每一種都有，像長在土裡的根細胞通常就沒有。',
  ],
  start: '開始探索',
};

export const ORGANELLES = [
  {
    id: 'cell_wall', zh: '細胞壁', en: 'Cell wall',
    tagline: '撐住細胞形狀、保護細胞的堅韌外殼',
    body: '細胞壁是植物細胞最外面的一層堅韌外殼，位在細胞膜外側，主要成分是纖維素。它讓細胞保持形狀、抵擋外力，再加上液泡吸飽水撐住細胞，植物沒有骨骼也能挺立。',
    fact: '木材的主要成分，其實就是死去細胞留下來的細胞壁。',
    pickable: true,
  },
  {
    id: 'cell_membrane', zh: '細胞膜', en: 'Cell membrane',
    tagline: '控制物質進出細胞的薄膜',
    body: '細胞膜是緊貼在細胞壁內側的一層薄膜，由磷脂質和蛋白質組成。它像一道有選擇的關卡，決定水、養分和廢物能不能進出細胞，讓細胞內部保持穩定。',
    fact: '細胞膜的磷脂質排成兩層，離子和葡萄糖等分子很難直接穿過，要靠膜上的蛋白質幫忙。',
    pickable: true,
  },
  {
    id: 'cytoplasm', zh: '細胞質', en: 'Cytoplasm',
    tagline: '細胞內的膠狀環境，反應在此進行',
    body: '細胞質是細胞膜以內、細胞核以外的所有內容物，包含膠狀的液體，以及浸在其中的各種構造。細胞裡許多化學反應都在這裡進行，物質也在其中移動。',
    fact: '成熟植物細胞的細胞質，常被大液泡擠成貼著細胞膜的薄薄一層。',
    pickable: false,
  },
  {
    id: 'nucleus', zh: '細胞核', en: 'Nucleus',
    tagline: '儲存遺傳物質，指揮細胞的活動',
    body: '細胞核是包著雙層核膜的球形構造，裡面有遺傳物質 DNA，在成熟植物細胞中常被液泡擠到細胞邊緣。它依照 DNA 的指令，控制細胞要製造什麼、怎麼生長。',
    fact: '核膜上有許多核孔，攜帶指令的 RNA 就從這些小孔送到細胞質。',
    pickable: true,
  },
  {
    id: 'nucleolus', zh: '核仁', en: 'Nucleolus',
    tagline: '製造核糖體零件的地方',
    body: '核仁是細胞核裡顏色較深的小區域，沒有膜包著。核糖體所需的 RNA 在這裡製造，並和蛋白質組裝成核糖體的零件，再送出細胞核。',
    fact: '細胞分裂開始時，核仁會暫時消失，到分裂快結束時又重新出現。',
    pickable: true,
  },
  {
    id: 'rough_er', zh: '粗糙內質網', en: 'Rough endoplasmic reticulum',
    tagline: '附著核糖體、合成並加工蛋白質的膜囊',
    body: '粗糙內質網是一層層扁平的膜囊，與核膜相連，表面附著許多核糖體。核糖體合成的蛋白質會進到膜囊裡折疊、加工，之後再被送往下一站，例如高基氏體。',
    fact: '它表面看起來粗粗的，就是因為附著了核糖體，才叫「粗糙」。',
    pickable: true,
  },
  {
    id: 'smooth_er', zh: '平滑內質網', en: 'Smooth endoplasmic reticulum',
    tagline: '合成脂質的相連管網',
    body: '平滑內質網是一團互相連通的細管，表面沒有核糖體。它主要負責合成脂質，例如構成細胞膜的磷脂質，也參與某些物質的代謝，和粗糙內質網分工合作。',
    fact: '平滑內質網和粗糙內質網其實相連，是同一個膜系統的不同區域。',
    pickable: true,
  },
  {
    id: 'ribosome', zh: '核糖體', en: 'Ribosome',
    tagline: '依照指令把胺基酸接成蛋白質',
    body: '核糖體是細胞裡極小的顆粒，有些附著在粗糙內質網上，有些散在細胞質中。它讀取 RNA 的指令，把胺基酸一個個接成蛋白質，是細胞製造蛋白質的場所。',
    fact: '核糖體沒有膜包著，細菌、動物和植物的細胞裡都找得到它。',
    pickable: false,
  },
  {
    id: 'golgi', zh: '高基氏體', en: 'Golgi apparatus',
    tagline: '加工、分類並包裝運送蛋白質',
    body: '高基氏體是一疊弓形的扁平膜囊，植物細胞裡常有許多個，散布在細胞質中。它接收內質網送來的蛋白質，進一步加工、分類，再用邊緣長出的小泡，運送到細胞內外該去的地方。',
    fact: '植物的高基氏體會製造果膠等細胞壁成分；纖維素則是在細胞膜上合成。',
    pickable: true,
  },
  {
    id: 'mitochondrion', zh: '粒線體', en: 'Mitochondrion',
    tagline: '分解養分，把能量存進 ATP 供細胞使用',
    body: '粒線體是橢圓形、有雙層膜的構造，內膜向內摺疊形成許多皺褶，增加內膜面積。細胞在這裡利用氧氣分解養分，製造出 ATP，供細胞各種活動使用。',
    fact: '粒線體有自己的少量 DNA，科學家認為它的祖先是古老的細菌。',
    pickable: true,
  },
  {
    id: 'chloroplast', zh: '葉綠體', en: 'Chloroplast',
    tagline: '行光合作用，把光能存進養分裡',
    body: '葉綠體是雙層膜的橢圓構造，內部有類囊體堆疊成的葉綠餅，含有葉綠素。它利用光能把二氧化碳和水製成葡萄糖，並釋放出氧氣，是植物養分的來源。',
    fact: '葉綠體和粒線體一樣有自己的 DNA，祖先可能是古老的光合細菌。',
    pickable: true,
  },
  {
    id: 'vacuole', zh: '中央液泡', en: 'Central vacuole',
    tagline: '儲存水分與物質，撐起細胞',
    body: '中央液泡是成熟植物細胞裡的大水囊，儲存水分、養分和廢物，也讓細胞保持飽滿。真實細胞裡它所占的比例大得多，這裡刻意縮小，才看得見其他構造。',
    fact: '成熟植物細胞的液泡，可占整個細胞體積的約九成。',
    pickable: true,
  },
  {
    id: 'peroxisome', zh: '過氧化體', en: 'Peroxisome',
    tagline: '分解有毒的過氧化氫',
    body: '過氧化體是單層膜包成的小球，散布在細胞質中。它含有多種酵素，能處理細胞代謝時產生的過氧化氫，把這種有毒物質分解成水和氧，保護細胞不受傷害。',
    fact: '切開的馬鈴薯滴上雙氧水會冒泡，就是細胞裡的酵素把過氧化氫分解成水和氧氣。',
    pickable: true,
  },
  {
    id: 'plasmodesmata', zh: '原生質絲', en: 'Plasmodesmata',
    tagline: '貫穿細胞壁，連通相鄰的細胞',
    body: '原生質絲是穿過細胞壁的細小通道，連接相鄰植物細胞的細胞質。水分、小分子和部分訊號物質，可以經由它在細胞之間直接傳遞，不必先穿出細胞。',
    fact: '動物細胞沒有原生質絲，但有功能相近的隙型連結。',
    pickable: true,
  },
  {
    id: 'cytoskeleton', zh: '細胞骨架', en: 'Cytoskeleton',
    tagline: '支撐細胞、協助物質移動的纖維網',
    body: '細胞骨架是細胞質中由蛋白質纖維組成的網架，包括微管和微絲。它支撐細胞內部、固定構造的位置，也像軌道一樣協助物質與構造移動。',
    fact: '植物細胞的微管會影響纖維素的排列，進而影響細胞怎麼生長。',
    pickable: true,
  },
];

export const ORGANELLE_IDS = ORGANELLES.map((o) => o.id);
export const QUIZ_IDS = ORGANELLES.filter((o) => o.pickable).map((o) => o.id);
export function getOrganelle(id) {
  return ORGANELLES.find((o) => o.id === id);
}
