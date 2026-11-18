// 20 項細胞構造介紹的英文版（忠實對應 organelles.js 的中文）。
// 注意：本檔不 import 任何東西（比照 organelles.js 的規定）。

export const INTRO_EN = {
  title: 'Plant Cell',
  paragraphs: [
    'This is a schematic model of a mesophyll cell. Mesophyll cells are found inside the leaf and are the main site of photosynthesis.',
    'The primary walls of neighboring cells are held together by the middle lamella, and plasmodesmata pass through the walls so that the cytoplasm of neighboring cells is interconnected.',
    'To make the other structures easier to see, the vacuole in this model is deliberately reduced in scale; in a real mature cell, the vacuole often takes up most of the volume.',
  ],
  start: 'Start exploring',
};

export const ORGANELLES_EN = {
  cell_wall: {
    tagline: 'The outer layer of the cell, in which cellulose microfibrils resist turgor pressure',
    body: 'The primary wall lies outside the plasma membrane. It consists of cellulose microfibrils woven into a matrix of pectin and hemicellulose. Cellulose is synthesized at the plasma membrane by the cellulose synthase complex, whereas the matrix polysaccharides are secreted by the Golgi bodies. The wall must withstand the turgor pressure generated as the cell takes up water and, together with the vacuole, helps the plant stay upright. It is relatively thin and extensible, and it can be irreversibly stretched as the cell grows.',
    fact: 'The orientation of cortical microtubules often guides the deposition of cellulose microfibrils and therefore influences the direction in which the cell elongates.',
  },
  middle_lamella: {
    tagline: 'A pectin-rich wall layer that holds neighboring cells together',
    body: 'The middle lamella lies between the primary walls of two adjacent cells. Its main component is pectin, and pectin molecules can be cross-linked by calcium ions into a gel. It develops from the cell plate during cell division and is the first wall layer to form; like glue, it holds neighboring cells together. When pectin is broken down by enzymes, the adhesion between cells decreases, which is one of the reasons fruit softens during ripening. Plasmodesmata pass through the middle lamella and the primary walls on either side.',
    fact: 'Jam also relies on pectin to set, but the pectin mostly gels under high-sugar, acidic conditions, a different mechanism from the calcium cross-linking in the middle lamella.',
  },
  cell_membrane: {
    tagline: 'A phospholipid bilayer membrane with embedded proteins and selective permeability',
    body: 'The plasma membrane is a phospholipid bilayer with embedded proteins, lying tight against the inner side of the primary wall. Its hydrophobic core makes it hard for ions and larger polar molecules to cross directly, so they must be transported through channel proteins, carrier proteins, or pumps; this is selective permeability. Cellulose synthase complexes in the membrane synthesize cellulose, and the proton pump pushes protons out of the cell, establishing the electrochemical gradient that drives many kinds of transport.',
    fact: 'The plasma membrane proton pump acidifies the cell wall; in the acid growth hypothesis, this is the basis of the wall loosening that allows the cell to elongate.',
  },
  cytoplasm: {
    tagline: 'The region inside the plasma membrane and outside the nucleus, containing the cytosol and various structures',
    body: 'The cytoplasm consists of the cytosol and the various structures suspended in it. In a mature mesophyll cell, the large vacuole squeezes the cytoplasm into a thin layer pressed against the plasma membrane, and structures such as chloroplasts are mostly distributed along this layer. Many metabolic reactions, such as glycolysis, take place in the cytosol. The cytoplasm also flows, driven by actin microfilaments and motor proteins, a process called cytoplasmic streaming.',
    fact: 'The internodal cells of Chara grow several centimeters long, and cytoplasmic streaming in them can reach about 70 µm per second, making them a classic experimental system for studying myosin motors.',
  },
  nucleus: {
    tagline: 'Houses the genome inside a double-membrane nuclear envelope and regulates gene expression',
    body: 'The nucleus is enclosed by a double-membrane nuclear envelope, whose outer membrane is continuous with the rough endoplasmic reticulum (rough ER). Nuclear pores in the envelope selectively control the passage of RNA and proteins. The nucleus contains chromatin and the nucleolus; DNA is replicated and transcribed here, and the messenger RNA (mRNA) produced is exported through the nuclear pores to the cytoplasm for translation. In a mature mesophyll cell, the nucleus is often pushed by the vacuole toward the side next to the cell wall. Most proteins of the cell are encoded by nuclear genes, whereas chloroplasts and mitochondria have a small number of genes of their own.',
    fact: 'When a cell divides, the nuclear envelope breaks down and its membrane components merge into the ER; at telophase, ER membranes surround the chromosomes and reassemble into a nuclear envelope.',
  },
  nucleolus: {
    tagline: 'A region within the nucleus where ribosomal RNA is transcribed and ribosomal subunits are assembled',
    body: 'The nucleolus is a region inside the nucleus that is not membrane-bound. It is formed by the aggregation of the genes for ribosomal RNA (rRNA), rRNA that is being transcribed and processed, and proteins. Here the rRNA combines with ribosomal proteins imported from the cytoplasm to form the large and small subunits, which are then exported to the cytoplasm through the nuclear pores. The nucleolus is not a fixed structure: its size changes with the physiological state of the cell, and in cells with a high demand for protein synthesis it is often more prominent.',
    fact: 'During prophase of cell division, the nucleolus disperses as chromatin condenses, and it re-forms only at telophase.',
  },
  chromatin: {
    tagline: 'Fibers in the nucleus made of DNA and histones',
    body: 'Chromatin is a fiber formed when DNA wraps around histones to make nucleosomes, which then fold further; it is located in the nucleus. Regions that are less compact and available for transcription are called euchromatin, whereas highly condensed regions with low transcriptional activity are called heterochromatin. Gene expression is regulated by chemical modifications of histones and by DNA methylation. When a cell divides, chromatin condenses into chromosomes.',
    fact: 'The patterns of DNA methylation in plants are more diverse than in animals: besides CG, the CHG and CHH sequence contexts (H is A, T, or C) can also be methylated.',
  },
  rough_er: {
    tagline: 'Flattened cisternae with attached ribosomes that synthesize secretory and membrane proteins',
    body: 'The rough endoplasmic reticulum (rough ER) consists of flattened cisternae bounded by a single membrane and continuous with the outer nuclear membrane; its lumen is connected with the space between the two membranes of the nuclear envelope. Ribosomes attached to the membrane synthesize proteins that carry a signal sequence, which are threaded into the ER lumen as they are being translated. In the lumen they fold, form disulfide bonds, and receive oligosaccharides. Correctly folded proteins are carried by transport vesicles to the Golgi bodies and then distributed to the vacuole, the plasma membrane, or the outside of the cell. In cells that make large amounts of secretory proteins, the rough ER is usually especially well developed.',
    fact: 'When misfolded proteins accumulate in the ER lumen, they trigger the unfolded protein response (UPR), by which the cell increases the expression of molecular chaperones and other factors to help the proteins refold or to degrade them.',
  },
  smooth_er: {
    tagline: 'A tubular membrane network that synthesizes lipids and links various structures',
    body: 'The smooth endoplasmic reticulum (smooth ER) is an interconnected tubular membrane network. Its membrane has no ribosomes, and its lumen is continuous with that of the rough ER. It is the main site of phospholipid synthesis; it further elongates and modifies the fatty acids made in plastids, and it is also the starting point for the formation of oil bodies. The glycolipids specific to chloroplast membranes, however, are assembled on the chloroplast envelope. The tubules of the ER extend to the vicinity of the plasma membrane and come into close contact with structures such as chloroplasts and peroxisomes, which facilitates the exchange of lipids and other substances.',
    fact: null,
  },
  ribosome: {
    tagline: 'Ribosomes join amino acids into polypeptide chains according to the codons of messenger RNA',
    body: 'Ribosomes consist of ribosomal RNA (rRNA) and several dozen proteins, assembled into a large and a small subunit, and are not membrane-bound. They join amino acids into a polypeptide chain according to the codons of messenger RNA (mRNA). Free ribosomes in the cytosol synthesize proteins that stay in the cytoplasm or are sent to the nucleus, chloroplasts, mitochondria, and peroxisomes; ribosomes bound to the rough endoplasmic reticulum (rough ER) synthesize secretory proteins, vacuolar proteins, and membrane proteins of the endomembrane system. Mitochondria and chloroplasts also contain their own bacterial-type ribosomes.',
    fact: 'Chloroplast ribosomes, like those of bacteria, are sensitive to chloramphenicol, whereas cytoplasmic ribosomes are unaffected; this is one piece of evidence for the endosymbiotic origin of chloroplasts.',
  },
  golgi: {
    tagline: 'Where proteins and wall polysaccharides are modified, sorted, and dispatched',
    body: 'A Golgi body is made of several stacked cisternae and has a cis face and a trans face. In plant cells, Golgi bodies are often dispersed as many separate stacks that can move along actin microfilaments. Proteins delivered from the endoplasmic reticulum (ER) advance from the cis face toward the trans face, undergoing modifications such as glycosylation, and are then sorted and packaged. Plant Golgi bodies also synthesize cell wall matrix polysaccharides such as pectin and hemicellulose, which are carried by secretory vesicles to the plasma membrane, where the vesicles fuse with it and release their contents into the wall.',
    fact: 'During cell division, vesicles derived from Golgi bodies gather at the center of the cell along the phragmoplast and fuse to form the cell plate, the precursor of the new wall.',
  },
  mitochondrion: {
    tagline: 'A double-membrane structure that makes ATP by oxidative phosphorylation',
    body: 'A mitochondrion is enclosed by an inner and an outer membrane; the inner membrane is folded inward into cristae to increase its surface area, and the space it encloses is called the matrix. The citric acid cycle takes place in the matrix, whereas the electron transport chain and ATP synthase are located in the inner membrane and use the proton gradient established by electron transport to synthesize ATP. ATP is a molecule that carries energy, and it supplies the energy-requiring reactions of the cell. In mesophyll cells, mitochondria also take part in photorespiration.',
    fact: 'Mitochondria and chloroplasts both have a double membrane and their own DNA, and are thought to have originated from bacteria engulfed by early eukaryotic cells; this is the endosymbiont theory.',
  },
  chloroplast: {
    tagline: 'The site of photosynthesis, where the light reactions and the Calvin cycle take place',
    body: 'A chloroplast is enclosed by a double membrane and contains a further membrane system inside: the thylakoids, whose stacks are called grana. The photosystems and electron transport chain in the thylakoid membrane carry out the light reactions, producing ATP and NADPH and releasing oxygen. The surrounding stroma carries out the Calvin cycle, which fixes carbon dioxide and then uses the ATP and NADPH to reduce it to sugars, so that light energy is stored in organic molecules. Chloroplasts also have their own DNA.',
    fact: 'Chloroplasts move within the cell according to the intensity of light: in weak light they gather at the walls facing the light, and in strong light they move to the side walls to avoid damage.',
  },
  vacuole: {
    tagline: 'A large membranous sac that maintains turgor pressure and stores solutes',
    body: 'The vacuole is enclosed by a single membrane, the tonoplast, and contains water, ions, sugars, organic acids, pigments, and other substances, as well as hydrolytic enzymes that can break down old components of the cell. Proton pumps and transport proteins in the tonoplast move solutes into the vacuole, so that the cell takes up water by osmosis and develops turgor pressure, which drives cell elongation and, together with the cell wall, helps the plant stay upright. In a mature cell the vacuole often takes up most of the volume; to make the other structures easier to see, this model deliberately shows it smaller, so it is not shown in true proportion.',
    fact: 'The red, purple, and blue colors of flowers and fruits mostly come from anthocyanins stored in the vacuole, and the color also changes with the pH of the vacuole.',
  },
  transvacuolar_strand: {
    tagline: 'Cytoplasmic strands that pass through the vacuole and connect the region around the nucleus with the cell periphery',
    body: 'A transvacuolar strand is a channel of cytoplasm that runs through the vacuole, surrounded by the tonoplast, and contains endoplasmic reticulum (ER) and actin microfilaments. It connects the cytoplasm around the nucleus with the cortical cytoplasm next to the plasma membrane, serving as a shortcut for the movement of materials and various structures. The positions and thickness of these strands change constantly, and their dynamics depend on actin microfilaments.',
    fact: 'In cells with very large vacuoles, such as suspension-cultured cells and root hairs, the nucleus is sometimes suspended in the center of the vacuole, held in place by several transvacuolar strands.',
  },
  peroxisome: {
    tagline: 'A single-membrane compartment that isolates oxidative reactions and breaks down hydrogen peroxide',
    body: 'A peroxisome is a small sac enclosed by a single membrane. It contains oxidases and catalase; the latter breaks down the hydrogen peroxide produced by oxidative reactions into water and oxygen, preventing it from damaging the cell. In mesophyll cells, peroxisomes cooperate with chloroplasts and mitochondria to carry out photorespiration, and are responsible for oxidizing glycolate. When oilseeds germinate, specialized glyoxysomes break down stored fatty acids by β-oxidation and the glyoxylate cycle, and the products are then converted to sugars through mitochondria and the cytosol.',
    fact: 'Photorespiration begins when Rubisco attaches oxygen rather than carbon dioxide to RuBP; the products must be recovered through the chloroplast, peroxisome, and mitochondrion, and in the process some of the fixed carbon and energy is lost.',
  },
  oil_body: {
    tagline: 'A small oil-storage sphere in which a phospholipid monolayer encloses triacylglycerols',
    body: 'The core of an oil body is triacylglycerols, surrounded by only a single phospholipid monolayer. Triacylglycerols are generally thought to accumulate between the two leaflets of the endoplasmic reticulum (ER) membrane and then bud off toward the cytoplasm, so that only one leaflet is taken along. Oilseeds have numerous oil bodies, whose surface is studded with oleosins that keep the oil droplets from fusing; during germination the oil is converted to sugars through β-oxidation, the glyoxylate cycle, and gluconeogenesis. Mesophyll cells also have a small number of smaller oil bodies (also called lipid droplets), whose surface proteins differ from those of seed oil bodies.',
    fact: 'Oleosins help keep oil droplets separate, instead of fusing into large lumps of oil, even when the seed is dry or cold.',
  },
  plasmodesmata: {
    tagline: 'Channels through the cell wall that connect the cytoplasm of neighboring cells',
    body: 'Plasmodesmata are narrow channels that pass through the walls and the middle lamella between neighboring cells. The pore is lined with the plasma membrane, and in its center runs a thin tube, the desmotubule, formed from modified endoplasmic reticulum (ER) membrane. The cytoplasmic sleeve between the two is the main route for substances to pass. Sugars, ions, and signaling molecules can diffuse through, so that the cytoplasm of neighboring cells is connected into a symplast. The pore size is regulated by the deposition of callose.',
    fact: 'Gap junctions in animals are made of protein channels; plasmodesmata are instead cytoplasmic channels lined with the plasma membrane and containing ER, so their structure is different.',
  },
  microtubule: {
    tagline: 'Cortical cytoskeletal filaments that guide the direction of cellulose microfibril deposition',
    body: 'Cortical microtubules are microtubules lying against the inner side of the plasma membrane, formed by the polymerization of α/β-tubulin dimers into hollow tubes about 25 nm in diameter. They are arranged roughly in parallel and guide the paths along which cellulose synthase complexes move in the plasma membrane, and so influence the orientation of the cellulose microfibrils and the direction of cell elongation. Microtubules also make up the spindle, the preprophase band, and the phragmoplast, and kinesins can transport materials along microtubules.',
    fact: 'Flowering plants lack cytoplasmic dynein, so transport along microtubules is mainly carried out by kinesins.',
  },
  actin_filament: {
    tagline: 'Tracks made of actin, along which myosin moves cargo',
    body: 'Actin microfilaments are thin filaments, about 7 nm in diameter, polymerized from globular actin (G-actin); they have polarity. They are distributed in bundles in the cortex and in the transvacuolar strands. Myosin moves along them, dragging vesicles and various structures with it, which produces cytoplasmic streaming. Microfilaments also take part in chloroplast positioning, endocytosis and exocytosis, and in transport during cell plate formation.',
    fact: 'Chara myosin XI can move at about 60 µm per second, the fastest myosin measured so far; myosin XI in flowering plants also drives cytoplasmic streaming.',
  },
};
