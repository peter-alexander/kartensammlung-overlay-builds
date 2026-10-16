// Generated once from the pre-manifest NÖ-Atlas integration.
// Keep these overrides only for stable public ids/names and intentional
// presentation composition. New Atlas presentations are discovered automatically.

export const NOE_ATLAS_LEGACY_DATASETS = Object.freeze([
	{
		"id": "bh",
		"name": "Bezirkshauptmannschaften",
		"service": "ags_dienststellen",
		"layers": [
			"10"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_dienststellen",
				"query": "bezirkshauptmannschaft_bh"
			}
		]
	},
	{
		"id": "lkw",
		"name": "LKW-Durchfahrtsverbote",
		"service": "ags_lkw_durchfahrtsverbote",
		"layers": [
			"21",
			"22",
			"23",
			"24",
			"25",
			"27"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_lkw_durchfahrtsverbote",
				"query": "kundmachungen"
			},
			{
				"service": "ags_lkw_durchfahrtsverbote",
				"query": "strecken"
			}
		]
	},
	{
		"id": "top-radrouten",
		"name": "Top Radrouten",
		"service": "ags_radwege",
		"layers": [
			"4"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_radwege",
				"query": "top_radroute2"
			}
		]
	},
	{
		"id": "hwmodell-hq30-wasserspiegel",
		"name": "Hochwasser Modell – HQ30 Wasserspiegel",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"12"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq30_wasserspiegel"
			}
		]
	},
	{
		"id": "hwmodell-hq100-wasserspiegel",
		"name": "Hochwasser Modell – HQ100 Wasserspiegel",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"6"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq100_wasserspiegel"
			}
		]
	},
	{
		"id": "hwmodell-hq30-wassertiefe",
		"name": "Hochwasser Modell – HQ30 Wassertiefe",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"10"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq30_wassertiefe"
			}
		]
	},
	{
		"id": "hwmodell-hq100-wassertiefe",
		"name": "Hochwasser Modell – HQ100 Wassertiefe",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"9"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq100_wassertiefe"
			}
		]
	},
	{
		"id": "hwmodell-hq30-fliessgeschwindigkeit",
		"name": "Hochwasser Modell – HQ30 Fließgeschwindigkeit",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"15"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq30_fliessgeschwindigkeit"
			}
		]
	},
	{
		"id": "hwmodell-hq100-fliessgeschwindigkeit",
		"name": "Hochwasser Modell – HQ100 Fließgeschwindigkeit",
		"service": "ags_hochwasser_modellberechnung@atlas_wasser",
		"layers": [
			"5"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_hochwasser_modellberechnung@atlas_wasser",
				"query": "hq100_fliessgeschwindigkeit"
			}
		]
	},
	{
		"id": "gw-gespannt",
		"name": "Grundwasser – gespannte Grundwassergebiete",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"0"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-messstellen-qualitaet",
		"name": "Grundwasser – Messstellen Qualität",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"4"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_grundwasser@atlas_wasser",
				"query": "grundwasser_messstellen_qualitaet_gzuev"
			}
		]
	},
	{
		"id": "gw-messstellen-quantitaet",
		"name": "Grundwasser – Messstellen Quantität",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"2"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_grundwasser@atlas_wasser",
				"query": "grundwasser_messstellen_quantitaet"
			}
		]
	},
	{
		"id": "gw-flurabstand-marchfeld",
		"name": "Grundwasser – Flurabstand Marchfeld",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"19"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-flurabstand-tullnerfeld-nord",
		"name": "Grundwasser – Flurabstand nördliches Tullnerfeld",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"20"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-flurabstand-tullnerfeld-sued",
		"name": "Grundwasser – Flurabstand südliches Tullnerfeld",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"21"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-flurabstand-wiener-becken",
		"name": "Grundwasser – Flurabstand Wiener Becken",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"22"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-hgw100-detail",
		"name": "Grundwasser – HGW100 Isolinien Detail",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"6"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-hgw100-uebersicht",
		"name": "Grundwasser – HGW100 Isolinien Übersicht",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"7"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-mittel-detail",
		"name": "Grundwasser – mittlerer Grundwasserstand Detail",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"9"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_grundwasser@atlas_wasser",
				"query": "mittlerer_grundwasser_stand"
			}
		]
	},
	{
		"id": "gw-mittel-uebersicht",
		"name": "Grundwasser – mittlerer Grundwasserstand Übersicht",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"10"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_grundwasser@atlas_wasser",
				"query": "mittlerer_grundwasser_stand"
			}
		]
	},
	{
		"id": "gw-unsicherheit",
		"name": "Grundwasser – Unsicherheitsbereiche",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"11"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "gw-sonderflaechen",
		"name": "Grundwasser – Sonderflächen",
		"service": "ags_grundwasser@atlas_wasser",
		"layers": [
			"12"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "fliessgewaesser-messstellen-qualitaet",
		"name": "Fließgewässer – Messstellen Qualität",
		"service": "ags_fliessgewaesser@atlas_wasser",
		"layers": [
			"4"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser@atlas_wasser",
				"query": "fliessgewaesser_messstellen_qualitaet_gzuev"
			}
		]
	},
	{
		"id": "fliessgewaesser-messstellen-quantitaet",
		"name": "Fließgewässer – Messstellen Quantität",
		"service": "ags_fliessgewaesser@atlas_wasser",
		"layers": [
			"5"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser@atlas_wasser",
				"query": "fliessgewaesser_messstellen_quantitaet"
			}
		]
	},
	{
		"id": "fliessgewaesser-einzugsgebiete-klein",
		"name": "Fließgewässer – Einzugsgebiete 1–2 km²",
		"service": "ags_fliessgewaesser@atlas_wasser",
		"layers": [
			"23"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser@atlas_wasser",
				"query": "einzugsgebiet_gr1_2km2"
			}
		]
	},
	{
		"id": "fliessgewaesser-netz",
		"name": "Fließgewässer – Gewässernetz",
		"service": "ags_fliessgewaesser@atlas_wasser",
		"layers": [
			"62"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser@atlas_wasser",
				"query": "gewaessernetz_routen"
			}
		]
	},
	{
		"id": "abfluss-pegel",
		"name": "Abflusskennwerte – Pegel",
		"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
		"layers": [
			"30"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
				"query": "pegel"
			}
		]
	},
	{
		"id": "abfluss-abu-gzp",
		"name": "Abflusskennwerte – ABU / GZP",
		"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
		"layers": [
			"31"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
				"query": "abu__gzp"
			}
		]
	},
	{
		"id": "abfluss-hora3",
		"name": "Abflusskennwerte – HORA3",
		"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
		"layers": [
			"34"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
				"query": "hora3_kennwerte"
			}
		]
	},
	{
		"id": "abfluss-hora2",
		"name": "Abflusskennwerte – HORA2",
		"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
		"layers": [
			"36"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
				"query": "hora2_kennwerte"
			}
		]
	},
	{
		"id": "abfluss-gutachten",
		"name": "Abflusskennwerte – Abflussgutachten",
		"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
		"layers": [
			"37"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
				"query": "abflussgutachten"
			}
		]
	},
	{
		"id": "wlv-status",
		"name": "Wildbach/Lawinen – Status Gefahrenzonen",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"0"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
				"query": "gzp_status"
			}
		]
	},
	{
		"id": "wlv-plangebiete",
		"name": "Wildbach/Lawinen – Plangebiete",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"12"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-raumrelevant",
		"name": "Wildbach/Lawinen – raumrelevante Bereiche",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"13"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-wildbach-rot",
		"name": "Wildbach – rote Zonen",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"20"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-wildbach-gelb",
		"name": "Wildbach – gelbe Zonen",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"18"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-lawine-rot",
		"name": "Lawinen – rote Zonen",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"19"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-lawine-gelb",
		"name": "Lawinen – gelbe Zonen",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"17"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-blau",
		"name": "Wildbach/Lawinen – blaue Vorbehaltsbereiche",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"15"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-braun",
		"name": "Wildbach/Lawinen – braune Hinweisbereiche",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"16"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-violett",
		"name": "Wildbach/Lawinen – violette Hinweisbereiche",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"14"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wlv-einzugsgebiete",
		"name": "Wildbach/Lawinen – Haupteinzugsgebiete",
		"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
		"layers": [
			"1"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wildbach_lawinen_kataster@atlas_wasser",
				"query": "wlv_haupteinzugsgebiete"
			}
		]
	},
	{
		"id": "energie-windkraft",
		"name": "Energie – Windkraftanlagen",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"3"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__energie@atlas_raumordnung",
				"query": "windkraftanlagen"
			}
		]
	},
	{
		"id": "energie-uw-apg",
		"name": "Energie – Umspannwerke APG",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100021"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__energie@atlas_raumordnung",
				"query": "umspannwerke_apg"
			}
		]
	},
	{
		"id": "energie-netz-apg",
		"name": "Energie – Übertragungsnetz APG",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100012"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__energie@atlas_raumordnung",
				"query": "uebertragungsnetz_apg"
			}
		]
	},
	{
		"id": "energie-abstand-uw",
		"name": "Energie – Achtungsabstand Umspannwerke APG",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100018"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "energie-abstand-leitung",
		"name": "Energie – Achtungsabstand Leitungen APG",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100017"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "energie-uw-dlm",
		"name": "Energie – Umspannwerke DLM",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100011"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__energie@atlas_raumordnung",
				"query": "umspannwerke_dlm"
			}
		]
	},
	{
		"id": "energie-netz-dlm",
		"name": "Energie – Hochspannungsnetz DLM",
		"service": "ags_raumordnung__energie@atlas_raumordnung",
		"layers": [
			"100008"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__energie@atlas_raumordnung",
				"query": "hochspannungsnetz_dlm"
			}
		]
	},
	{
		"id": "energieraum-prio1",
		"name": "Energieraumplanung – Nah-/Fernwärme Priorität I",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"2"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "energieraum-prio2",
		"name": "Energieraumplanung – Nah-/Fernwärme Priorität II",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"8"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "energieraum-prio3",
		"name": "Energieraumplanung – Nah-/Fernwärme Priorität III",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"9"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "energieraum-mobilitaet-waerme",
		"name": "Energieraumplanung – Mobilität & Wärme",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"0"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_energieraumplanung@atlas_raumordnung",
				"query": "stor_mobilitaet__waerme"
			}
		]
	},
	{
		"id": "energieraum-waerme-saniert",
		"name": "Energieraumplanung – Wärme saniert",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"6"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_energieraumplanung@atlas_raumordnung",
				"query": "stor_waerme_saniert"
			}
		]
	},
	{
		"id": "energieraum-waerme",
		"name": "Energieraumplanung – Wärme",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"7"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_energieraumplanung@atlas_raumordnung",
				"query": "stor_waerme"
			}
		]
	},
	{
		"id": "energieraum-mobilitaet",
		"name": "Energieraumplanung – Mobilität",
		"service": "ags_energieraumplanung@atlas_raumordnung",
		"layers": [
			"3"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_energieraumplanung@atlas_raumordnung",
				"query": "stor_mobilitaet"
			}
		]
	},
	{
		"id": "oekostrom-pv",
		"name": "Ökostrom – PV-Standortzonen",
		"service": "ags_raumordnung__oekostrom@atlas_raumordnung",
		"layers": [
			"100006"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__oekostrom@atlas_raumordnung",
				"query": "pvstandortzonen_20_noe_rog_2014"
			}
		]
	},
	{
		"id": "oekostrom-wind",
		"name": "Ökostrom – Wind-Standortzonen",
		"service": "ags_raumordnung__oekostrom@atlas_raumordnung",
		"layers": [
			"100026"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_raumordnung__oekostrom@atlas_raumordnung",
				"query": "windstandortzonen_20_noe_rog_2014"
			}
		]
	},
	{
		"id": "wasserbuch",
		"name": "Wasserrecht – Wasserbuch",
		"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
		"layers": [
			"0",
			"1",
			"26",
			"27",
			"28",
			"29",
			"30",
			"31",
			"32",
			"35",
			"36",
			"37",
			"38",
			"39",
			"40",
			"41",
			"42",
			"44",
			"45",
			"46",
			"47",
			"49",
			"50",
			"51",
			"52",
			"53",
			"54",
			"55",
			"56",
			"57",
			"58",
			"59",
			"60",
			"61",
			"62",
			"63"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
				"query": "wasserbuch_punkte_wis"
			},
			{
				"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
				"query": "wasserbuch_flaechen_wis"
			}
		]
	},
	{
		"id": "wasserrecht-schongebiet",
		"name": "Wasserrecht – Schongebiete",
		"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
		"layers": [
			"0"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "wasserrecht_schongebiete"
			}
		]
	},
	{
		"id": "wasserrecht-schutzgebiet",
		"name": "Wasserrecht – Schutzgebiete",
		"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
		"layers": [
			"1"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "wasserrechtl_schutzgebiete"
			}
		]
	},
	{
		"id": "wasserrecht-beschraenkungen",
		"name": "Wasserrecht – wasserwirtschaftliche Beschränkungen",
		"service": "ags_wasserrecht__wasserbuch@atlas_wasser",
		"layers": [
			"44"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "wasserwirtschaftl_beschraenkungen"
			}
		]
	},
	{
		"id": "wasserrecht-ngp-querelemente",
		"name": "Wasserrecht – NGP Querelemente",
		"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
		"layers": [
			"105"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "querelemente_ngp"
			}
		]
	},
	{
		"id": "wasserrecht-ngp-restwasser",
		"name": "Wasserrecht – NGP Restwasserstrecken",
		"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
		"layers": [
			"103"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "restwasserstrecken_ngp"
			}
		]
	},
	{
		"id": "wasserrecht-ngp-wasserkoerper",
		"name": "Wasserrecht – NGP Wasserkörper",
		"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
		"layers": [
			"104"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__wasserrecht@atlas_wasser",
				"query": "wasserkoerper_ngp"
			}
		]
	},
	{
		"id": "retention-verordnet",
		"name": "Retentionsflächen – verordnet",
		"service": "ags_wasserrecht__retentionsflaechen@atlas_wasser",
		"layers": [
			"88"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__retentionsflaechen@atlas_wasser",
				"query": "hochwasser_schutzzonen_plan_verordnet"
			}
		]
	},
	{
		"id": "retention-nicht-verordnet",
		"name": "Retentionsflächen – nicht verordnet",
		"service": "ags_wasserrecht__retentionsflaechen@atlas_wasser",
		"layers": [
			"91"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__retentionsflaechen@atlas_wasser",
				"query": "hochwasser_schutzzonen_plan_nicht_verordnet"
			}
		]
	},
	{
		"id": "schifffahrtsanlagen",
		"name": "Wasserrecht – Schifffahrtsanlagen",
		"service": "ags_wasserrecht__schifffahrt@atlas_wasser",
		"layers": [
			"10"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__schifffahrt@atlas_wasser",
				"query": "schifffahrtsanlagen"
			}
		]
	},
	{
		"id": "emission-co2",
		"name": "Emissionskataster – CO₂neE je Gemeinde",
		"service": "wms_emikat",
		"layers": [
			"GemeindeEmissionsdichtenKartenstufe1|Profil_Gem_Co2neetkm2"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "emission-nox",
		"name": "Emissionskataster – NOx je Gemeinde",
		"service": "wms_emikat",
		"layers": [
			"GemeindeEmissionsdichtenKartenstufe1|Profil_Gem_Noxkgkm2"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "emission-so2",
		"name": "Emissionskataster – SO₂ je Gemeinde",
		"service": "wms_emikat",
		"layers": [
			"GemeindeEmissionsdichtenKartenstufe1|Profil_Gem_So2kgkm2"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "emission-pm10",
		"name": "Emissionskataster – PM10 je Gemeinde",
		"service": "wms_emikat",
		"layers": [
			"GemeindeEmissionsdichtenKartenstufe1|Profil_Gem_Pm10kgkm2"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "flaechenwidmung",
		"name": "Flächenwidmungspläne",
		"service": "wms_flaechenwidmung@atlas_raumordnung",
		"layers": [
			"WMS"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "landwirtschaft",
		"name": "Landwirtschaft – Agrarverfahren und Produktionsgebiete",
		"service": "ags_landwirtschaft__landwirtschaft",
		"layers": [
			"3",
			"20",
			"27",
			"28",
			"29",
			"30",
			"43"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_landwirtschaft__landwirtschaft",
				"query": "agrarverfahren"
			},
			{
				"service": "ags_landwirtschaft__landwirtschaft",
				"query": "lw_produktionsgebiete"
			},
			{
				"service": "ags_landwirtschaft__landwirtschaft",
				"query": "wertvolle_lw_flaechen"
			}
		]
	},
	{
		"id": "luft-pm10-sanierung",
		"name": "Luft – PM10-Sanierungsgebiete IG-L",
		"service": "ags_luft",
		"layers": [
			"4"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_luft",
				"query": "pm10_sanierungsgebiete_ig_l"
			}
		]
	},
	{
		"id": "naturschutz-alpen-karpaten",
		"name": "Naturschutz – Alpen-Karpaten-Korridor",
		"service": "ags_naturschutz",
		"layers": [
			"15"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "naturschutz-alpen-karpaten-engstellen",
		"name": "Naturschutz – Alpen-Karpaten-Korridor Engstellen",
		"service": "ags_naturschutz",
		"layers": [
			"16"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "naturschutz-biber-verordnung",
		"name": "Naturschutz – Geltungsbereich Biber-Verordnung",
		"service": "ags_naturschutz",
		"layers": [
			"12"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "naturschutz-fischotter-verordnung",
		"name": "Naturschutz – Geltungsbereich Fischotter-Verordnung",
		"service": "ags_naturschutz",
		"layers": [
			"47"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "naturschutz-wildtierkorridore",
		"name": "Naturschutz – Wildtier-Wanderkorridore",
		"service": "ags_naturschutz",
		"layers": [
			"43"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_naturschutz",
				"query": "wildtier_wanderkorridor"
			}
		]
	},
	{
		"id": "naturschutz-wildtier-engstellen",
		"name": "Naturschutz – Wildtier-Wanderkorridore Engstellen / Kerngebiete",
		"service": "ags_naturschutz",
		"layers": [
			"42"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "naturschutz-kompensationsflaechen",
		"name": "Naturschutz – Kompensationsflächen",
		"service": "ags_naturschutz_kompensationsflaechen",
		"layers": [
			"70"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_naturschutz_kompensationsflaechen",
				"query": "kompensationsflaechen"
			}
		]
	},
	{
		"id": "oev-haltestellen",
		"name": "Öffentlicher Verkehr – Haltestellen",
		"service": "ags_oev___bus_und_haltestellen",
		"layers": [
			"14"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_oev___bus_und_haltestellen",
				"query": "haltestellen"
			}
		]
	},
	{
		"id": "oev-buslinien",
		"name": "Öffentlicher Verkehr – Buslinien",
		"service": "ags_oev___bus_und_haltestellen",
		"layers": [
			"15"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_oev___bus_und_haltestellen",
				"query": "buslinien"
			}
		]
	},
	{
		"id": "tierseuchen",
		"name": "Tierseuchen – Risikogebiete und Sperrzonen",
		"service": "ags_tierseuchen",
		"layers": [
			"16",
			"17",
			"18",
			"19",
			"20",
			"21",
			"22",
			"23",
			"24",
			"25",
			"26",
			"27",
			"28",
			"29",
			"30",
			"31",
			"32",
			"33",
			"34",
			"35"
		],
		"cache": 3600,
		"queries": []
	},
	{
		"id": "weinbau-region",
		"name": "Weinbau – Region",
		"service": "ags_landwirtschaft__weinbau_rieden_und_fluren",
		"layers": [
			"12"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "weinbau-gebiete",
		"name": "Weinbau – Gebiete",
		"service": "ags_landwirtschaft__weinbau_rieden_und_fluren",
		"layers": [
			"8"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "weinbau-grosslagen",
		"name": "Weinbau – Großlagen",
		"service": "ags_landwirtschaft__weinbau_rieden_und_fluren",
		"layers": [
			"11"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "weinbau-subrieden",
		"name": "Weinbau – Subrieden",
		"service": "ags_landwirtschaft__weinbau_rieden_und_fluren",
		"layers": [
			"4"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "wasserversorgung",
		"name": "Wasserversorgung – trinkwasserversorgte Gebiete",
		"service": "ags_wasserversorgung@atlas_wasser",
		"layers": [
			"10"
		],
		"cache": 86400,
		"queries": []
	},
	{
		"id": "fischereireviere",
		"name": "Fischereireviere",
		"service": "ags_wasserrecht__fischereireviere@atlas_wasser",
		"layers": [
			"9"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_wasserrecht__fischereireviere@atlas_wasser",
				"query": "fischereireviere"
			}
		]
	},
	{
		"id": "ragweed-funde",
		"name": "Ragweed – Funde (alle Jahre)",
		"service": "ags_ragweed",
		"layers": [
			"5"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_ragweed",
				"query": "ragweed_funde_alle_jahre"
			}
		]
	},
	{
		"id": "ragweed-gemeinden",
		"name": "Ragweed – betroffene Gemeinden (alle Jahre)",
		"service": "ags_ragweed",
		"layers": [
			"8"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_ragweed",
				"query": "ragweed_betroffene_gemeinden_alle_jahre"
			}
		]
	},
	{
		"id": "burgen-schloesser",
		"name": "Burgen und Schlösser",
		"service": "ags_atlas__burgen_und_schloesser",
		"layers": [
			"5"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_atlas__burgen_und_schloesser",
				"query": "burgen_und_schloesser"
			}
		]
	},
	{
		"id": "museen-sammlungen",
		"name": "Museen und Sammlungen",
		"service": "ags_atlas__museen_und_sammlungen",
		"layers": [
			"7"
		],
		"cache": 86400,
		"queries": [
			{
				"service": "ags_atlas__museen_und_sammlungen",
				"query": "museen_und_sammlungen"
			}
		]
	}
]);

export const NOE_ATLAS_LEGACY_BASEMAPS = Object.freeze([
	{
		"id": "vischer",
		"name": "Vischer-Karte",
		"category": "Historisch",
		"service": "wms_iws__historische_karten",
		"layers": [
			"VISCHER|default"
		],
		"cache": 604800
	},
	{
		"id": "administrativkarte",
		"name": "Administrativkarte",
		"category": "Historisch",
		"service": "wms_iws__historische_karten",
		"layers": [
			"ADMINK|default"
		],
		"cache": 604800
	},
	{
		"id": "franzisco-josephinisch",
		"name": "Franzisco-Josephinische Landesaufnahme",
		"category": "Historisch",
		"service": "wms_iws__historische_karten",
		"layers": [
			"SPEZIALK|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep01",
		"name": "Orthofoto Epoche 1 (1999–2005)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP01|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep02",
		"name": "Orthofoto Epoche 2 (2007–2009)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP02|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep03",
		"name": "Orthofoto Epoche 3 (2010–2012)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP03|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep04",
		"name": "Orthofoto Epoche 4 (2013–2015)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP04|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep05",
		"name": "Orthofoto Epoche 5 (2016–2018)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP05|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep06",
		"name": "Orthofoto Epoche 6 (2019–2021)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP06|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep07",
		"name": "Orthofoto Epoche 7 (2022–2024)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP07|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep08",
		"name": "Orthofoto Epoche 8 (2025–)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP08|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep03-cir",
		"name": "Orthofoto Epoche 3 CIR (2010–2012)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP03CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep04-cir",
		"name": "Orthofoto Epoche 4 CIR (2013–2015)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP04CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep05-cir",
		"name": "Orthofoto Epoche 5 CIR (2016–2018)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP05CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep06-cir",
		"name": "Orthofoto Epoche 6 CIR (2019–2021)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP06CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep07-cir",
		"name": "Orthofoto Epoche 7 CIR (2022–2024)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"EP07CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-ep08-cir",
		"name": "Orthofoto Epoche 8 CIR (2025–)",
		"category": "Historisch",
		"service": "wms_iws__luftbild_hoehe",
		"layers": [
			"EP08CIR|default"
		],
		"cache": 604800
	},
	{
		"id": "ortho-current",
		"name": "Orthofoto aktuell (RGB)",
		"category": "Luft- & Satellitenbilder",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"FAOF|default"
		],
		"cache": 86400
	},
	{
		"id": "ortho-current-cir",
		"name": "Orthofoto aktuell (CIR)",
		"category": "Luft- & Satellitenbilder",
		"service": "wms_iws__luftbild_epochen",
		"layers": [
			"FAOFCIR|default"
		],
		"cache": 86400
	}
]);

export const NOE_ATLAS_SPECIAL_QUERY_DATASETS = Object.freeze({
	"hangwasser-fliesswege": [
		{
			"service": "ags_hangwasser@atlas_wasser",
			"query": "fliesswege_akkumuliert_2018"
		}
	]
});
