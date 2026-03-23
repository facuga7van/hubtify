/**
 * Generator script for SmolLM2-360M fine-tuning dataset
 * Run with: npx tsx electron/modules/nutrition/training/generate-dataset.ts
 *
 * Generates JSONL in Unsloth/Alpaca format from food-db-seed.ts
 */

import { FOOD_SEED_DATA, type FoodSeedEntry } from '../food-db-seed';
import * as fs from 'fs';
import * as path from 'path';

const INSTRUCTION = 'Estimá las calorías de esta comida';

interface TrainingEntry {
  instruction: string;
  input: string;
  output: string;
}

function makeOutput(calories: number, breakdown: string): string {
  return JSON.stringify({ calories, breakdown });
}

function entry(input: string, calories: number, breakdown: string): TrainingEntry {
  return {
    instruction: INSTRUCTION,
    input,
    output: makeOutput(calories, breakdown),
  };
}

// Helper to pick random items from an array
function pick<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Build lookup maps
const foodByName = new Map<string, FoodSeedEntry>();
const foodByCategory = new Map<string, FoodSeedEntry[]>();

for (const f of FOOD_SEED_DATA) {
  foodByName.set(f.name, f);
  const cat = foodByCategory.get(f.category) || [];
  cat.push(f);
  foodByCategory.set(f.category, cat);
}

const entries: TrainingEntry[] = [];

// ============================================================
// SECTION 1: Direct from database (1 entry per food)
// ============================================================

for (const food of FOOD_SEED_DATA) {
  const keywords = food.keywords.split(',').map(k => k.trim());
  // Use the first keyword as the natural input (most natural phrasing)
  const naturalInput = keywords[0];
  const cal = food.calories;
  const breakdown = `${food.name} ~${cal}kcal (${food.serving_size})`;
  entries.push(entry(naturalInput, cal, breakdown));
}

// ============================================================
// SECTION 2: Quantity variations (~300 entries)
// ============================================================

interface QuantityVariation {
  foodName: string;
  inputs: string[];
  multiplier: number;
}

// Foods that make sense with quantities
const quantityFoods: QuantityVariation[] = [
  // Empanadas
  { foodName: 'Empanada de carne', inputs: ['dos empanadas de carne', 'dos empanadas', '2 empanadas de carne'], multiplier: 2 },
  { foodName: 'Empanada de carne', inputs: ['tres empanadas de carne', '3 empanadas de carne', 'tres empanadas'], multiplier: 3 },
  { foodName: 'Empanada de carne', inputs: ['cuatro empanadas de carne', '4 empanadas'], multiplier: 4 },
  { foodName: 'Empanada de pollo', inputs: ['dos empanadas de pollo', '2 empanadas de pollo'], multiplier: 2 },
  { foodName: 'Empanada de pollo', inputs: ['tres empanadas de pollo', '3 empanadas de pollo'], multiplier: 3 },
  { foodName: 'Empanada de jamón y queso', inputs: ['dos empanadas de jamón y queso', '2 empanadas de jyq', 'dos empanadas de jamon y queso'], multiplier: 2 },
  { foodName: 'Empanada de verdura', inputs: ['dos empanadas de verdura', '2 empanadas de verdura'], multiplier: 2 },
  { foodName: 'Empanada de verdura', inputs: ['tres empanadas de verdura', '3 empanadas de verdura'], multiplier: 3 },
  { foodName: 'Empanada de humita', inputs: ['dos empanadas de humita'], multiplier: 2 },
  { foodName: 'Empanada de carne frita', inputs: ['dos empanadas fritas', '2 empanadas fritas'], multiplier: 2 },
  { foodName: 'Empanada de carne frita', inputs: ['tres empanadas fritas', '3 empanadas fritas'], multiplier: 3 },
  { foodName: 'Empanada árabe', inputs: ['dos empanadas árabes', 'dos fatay', '2 sfijas'], multiplier: 2 },
  { foodName: 'Empanada árabe', inputs: ['tres fatay', '3 empanadas árabes'], multiplier: 3 },
  { foodName: 'Empanada caprese', inputs: ['dos empanadas caprese', '2 empanadas caprese'], multiplier: 2 },

  // Medialunas
  { foodName: 'Medialunas', inputs: ['dos medialunas', '2 medialunas'], multiplier: 2 },
  { foodName: 'Medialunas', inputs: ['tres medialunas', '3 medialunas'], multiplier: 3 },
  { foodName: 'Medialunas', inputs: ['cuatro medialunas', '4 medialunas'], multiplier: 4 },
  { foodName: 'Medialunas', inputs: ['media docena de medialunas', '6 medialunas'], multiplier: 6 },
  { foodName: 'Medialunas', inputs: ['una docena de medialunas', '12 medialunas', 'docena de medialunas'], multiplier: 12 },

  // Pizza
  { foodName: 'Pizza muzzarella (porción)', inputs: ['dos porciones de pizza', 'dos porciones de muzza', '2 porciones de pizza'], multiplier: 2 },
  { foodName: 'Pizza muzzarella (porción)', inputs: ['tres porciones de pizza', '3 porciones de muzza'], multiplier: 3 },
  { foodName: 'Pizza muzzarella (porción)', inputs: ['una pizza muzza entera', 'pizza entera de muzza', 'pizza completa'], multiplier: 8 },
  { foodName: 'Pizza napolitana (porción)', inputs: ['dos porciones de napo', '2 porciones de napolitana'], multiplier: 2 },
  { foodName: 'Fugazzeta (porción)', inputs: ['dos porciones de fugazzeta', '2 porciones de fugazza'], multiplier: 2 },
  { foodName: 'Fainá (porción)', inputs: ['dos porciones de fainá', '2 fainá'], multiplier: 2 },

  // Huevos
  { foodName: 'Huevo frito', inputs: ['dos huevos fritos', '2 huevos fritos'], multiplier: 2 },
  { foodName: 'Huevo frito', inputs: ['tres huevos fritos', '3 huevos fritos'], multiplier: 3 },
  { foodName: 'Huevo duro', inputs: ['dos huevos duros', '2 huevos duros'], multiplier: 2 },
  { foodName: 'Huevo duro', inputs: ['tres huevos duros', '3 huevos duros'], multiplier: 3 },
  { foodName: 'Huevo revuelto', inputs: ['dos huevos revueltos', '2 huevos revueltos'], multiplier: 2 },
  { foodName: 'Huevo revuelto', inputs: ['tres huevos revueltos', '3 huevos revueltos'], multiplier: 3 },

  // Facturas
  { foodName: 'Facturas (criollito)', inputs: ['dos facturas', '2 facturas', 'dos criollitos'], multiplier: 2 },
  { foodName: 'Facturas (criollito)', inputs: ['tres facturas', '3 facturas'], multiplier: 3 },
  { foodName: 'Facturas (criollito)', inputs: ['media docena de facturas', '6 facturas'], multiplier: 6 },

  // Panchos
  { foodName: 'Pancho', inputs: ['dos panchos', '2 panchos'], multiplier: 2 },

  // Sándwiches de miga
  { foodName: 'Sándwich de miga', inputs: ['dos sandwiches de miga', '2 sanguches de miga', 'dos sanguches de miga'], multiplier: 2 },
  { foodName: 'Sándwich de miga', inputs: ['tres sandwiches de miga', '3 sanguches de miga'], multiplier: 3 },
  { foodName: 'Sándwich de miga', inputs: ['cuatro sandwiches de miga', '4 sanguches de miga'], multiplier: 4 },
  { foodName: 'Sándwich de miga', inputs: ['cinco sandwiches de miga', '5 sanguches de miga'], multiplier: 5 },
  { foodName: 'Sándwich de miga', inputs: ['seis sandwiches de miga', '6 sanguches de miga'], multiplier: 6 },

  // Milanesas
  { foodName: 'Milanesa de carne', inputs: ['dos milanesas', '2 milanesas', 'dos milanesas de carne'], multiplier: 2 },
  { foodName: 'Milanesa de pollo', inputs: ['dos milanesas de pollo', '2 milanesas de pollo'], multiplier: 2 },

  // Helado
  { foodName: 'Helado 1 bocha', inputs: ['dos bochas de helado', '2 bochas de helado', 'helado 2 bochas'], multiplier: 2 },
  { foodName: 'Helado 1 bocha', inputs: ['tres bochas de helado', '3 bochas', 'helado 3 bochas'], multiplier: 3 },

  // Tacos
  { foodName: 'Tacos', inputs: ['dos tacos', '2 tacos'], multiplier: 2 },
  { foodName: 'Tacos', inputs: ['tres tacos', '3 tacos'], multiplier: 3 },
  { foodName: 'Taco de carne', inputs: ['dos tacos de carne', '2 tacos de carne'], multiplier: 2 },
  { foodName: 'Taco de carne', inputs: ['tres tacos de carne', '3 tacos de carne'], multiplier: 3 },

  // Bananas
  { foodName: 'Banana', inputs: ['dos bananas', '2 bananas'], multiplier: 2 },
  { foodName: 'Banana', inputs: ['tres bananas', '3 bananas'], multiplier: 3 },

  // Tostadas
  { foodName: 'Tostadas', inputs: ['dos tostadas', '2 tostadas'], multiplier: 2 },
  { foodName: 'Tostadas', inputs: ['tres tostadas', '3 tostadas'], multiplier: 3 },
  { foodName: 'Tostadas', inputs: ['cuatro tostadas', '4 tostadas'], multiplier: 4 },

  // Churros
  { foodName: 'Churros', inputs: ['seis churros', '6 churros', 'media docena de churros'], multiplier: 2 },

  // Alfajores
  { foodName: 'Alfajor simple', inputs: ['dos alfajores', '2 alfajores'], multiplier: 2 },
  { foodName: 'Alfajor de arroz', inputs: ['dos alfajores de arroz', '2 alfajores de arroz'], multiplier: 2 },
  { foodName: 'Alfajor triple', inputs: ['dos alfajores triples', '2 alfajores triples'], multiplier: 2 },

  // Bon o Bon
  { foodName: 'Bon o Bon', inputs: ['dos bon o bon', '2 bon o bon', 'dos bonobon'], multiplier: 2 },
  { foodName: 'Bon o Bon', inputs: ['tres bon o bon', '3 bon o bon', 'tres bonobon'], multiplier: 3 },

  // Chipá
  { foodName: 'Chipá', inputs: ['dos chipás', '2 chipá', 'dos chipas'], multiplier: 2 },
  { foodName: 'Chipá', inputs: ['tres chipás', '3 chipá', 'tres chipas'], multiplier: 3 },
  { foodName: 'Chipá', inputs: ['cuatro chipás', '4 chipá', 'cuatro chipas'], multiplier: 4 },

  // Bizcochitos
  { foodName: 'Bizcochitos de grasa', inputs: ['tres bizcochitos', '3 bizcochitos de grasa'], multiplier: 3 },
  { foodName: 'Bizcochitos de grasa', inputs: ['cuatro bizcochitos', '4 bizcochitos'], multiplier: 4 },
  { foodName: 'Bizcochitos de grasa', inputs: ['cinco bizcochitos', '5 bizcochitos de grasa'], multiplier: 5 },

  // Panqueques
  { foodName: 'Panqueques con dulce de leche', inputs: ['cuatro panqueques con dulce de leche', '4 panqueques con ddl'], multiplier: 2 },

  // Subway cookie
  { foodName: 'Subway Cookie', inputs: ['dos cookies de subway', '2 subway cookies'], multiplier: 2 },
  { foodName: 'Subway Cookie', inputs: ['tres cookies de subway', '3 subway cookies'], multiplier: 3 },

  // Croquetas
  { foodName: 'Croquetas de papa', inputs: ['ocho croquetas', '8 croquetas de papa'], multiplier: 2 },

  // Ferrero
  { foodName: 'Ferrero Rocher', inputs: ['dos ferrero rocher', '2 ferrero', 'dos ferreros'], multiplier: 2 },
  { foodName: 'Ferrero Rocher', inputs: ['tres ferrero rocher', '3 ferrero', 'tres ferreros'], multiplier: 3 },

  // Tamales
  { foodName: 'Tamales', inputs: ['dos tamales', '2 tamales'], multiplier: 2 },
  { foodName: 'Tamales', inputs: ['tres tamales', '3 tamales'], multiplier: 3 },

  // Humita
  { foodName: 'Humita en chala', inputs: ['dos humitas', '2 humitas en chala'], multiplier: 2 },

  // Nuggets
  { foodName: 'McNuggets x6', inputs: ['dos cajas de nuggets x6', '12 nuggets mc'], multiplier: 2 },

  // Sushi
  { foodName: 'Sushi roll (8 piezas)', inputs: ['dos rolls de sushi', '2 rolls', 'dos rolls'], multiplier: 2 },
  { foodName: 'Sushi roll (8 piezas)', inputs: ['tres rolls de sushi', '3 rolls'], multiplier: 3 },

  // KFC
  { foodName: 'KFC Crispy Strips x3', inputs: ['dos porciones de crispy strips kfc', '6 crispy strips kfc'], multiplier: 2 },

  // Manzana / frutas
  { foodName: 'Manzana', inputs: ['dos manzanas', '2 manzanas'], multiplier: 2 },
  { foodName: 'Naranja', inputs: ['dos naranjas', '2 naranjas'], multiplier: 2 },
  { foodName: 'Kiwi', inputs: ['dos kiwis', '2 kiwis'], multiplier: 2 },

  // Drinks - half liters / full liters
  { foodName: 'Coca Cola', inputs: ['medio litro de coca', 'coca 500ml', 'coca de medio litro'], multiplier: 1.5 },
  { foodName: 'Cerveza', inputs: ['dos latas de cerveza', '2 cervezas', 'dos birras'], multiplier: 2 },
  { foodName: 'Cerveza pinta', inputs: ['dos pintas', '2 pintas de cerveza', 'dos pintas de birra'], multiplier: 2 },
  { foodName: 'Vino tinto', inputs: ['dos copas de vino', '2 copas de vino tinto'], multiplier: 2 },
  { foodName: 'Vino tinto', inputs: ['tres copas de vino tinto', '3 copas de vino'], multiplier: 3 },
  { foodName: 'Fernet con coca', inputs: ['dos fernets', '2 fernets con coca', 'dos fernecitos'], multiplier: 2 },
  { foodName: 'Fernet con coca', inputs: ['tres fernets', '3 fernets con coca'], multiplier: 3 },

  // Danette
  { foodName: 'Danette chocolate', inputs: ['dos danette', '2 danette de chocolate', 'dos danette chocolate'], multiplier: 2 },

  // Galletitas
  { foodName: 'Galletitas Oreo', inputs: ['dos paquetes de oreo', '8 oreos'], multiplier: 2 },

  // Rhodesia
  { foodName: 'Rhodesia', inputs: ['dos rhodesias', '2 rhodesias'], multiplier: 2 },
  { foodName: 'Rhodesia', inputs: ['tres rhodesias', '3 rhodesias'], multiplier: 3 },

  // Shot
  { foodName: 'Shot', inputs: ['dos shot', '2 shots', 'dos shots'], multiplier: 2 },
  { foodName: 'Shot', inputs: ['tres shot', '3 shots'], multiplier: 3 },

  // Aceitunas
  { foodName: 'Aceitunas verdes', inputs: ['diez aceitunas', '10 aceitunas verdes'], multiplier: 2 },

  // Crepes
  { foodName: 'Crepe salado', inputs: ['dos crepes salados', '2 crepes', 'dos crepes'], multiplier: 2 },

  // Wraps
  { foodName: 'Wrap de pollo', inputs: ['dos wraps de pollo', '2 wraps'], multiplier: 2 },

  // Provoleta
  { foodName: 'Provoleta', inputs: ['dos provoletas', '2 provoletas'], multiplier: 2 },

  // Porciones de torta
  { foodName: 'Torta (porción)', inputs: ['dos porciones de torta', '2 porciones de torta'], multiplier: 2 },

  // Brownies
  { foodName: 'Brownie', inputs: ['dos brownies', '2 brownies'], multiplier: 2 },

  // Grido
  { foodName: 'Grido cucurucho', inputs: ['dos cucuruchos grido', '2 cucuruchos grido'], multiplier: 2 },
  { foodName: 'Grido palito helado', inputs: ['dos palitos grido', '2 palitos helados grido'], multiplier: 2 },
];

for (const qv of quantityFoods) {
  const food = foodByName.get(qv.foodName);
  if (!food) {
    console.warn(`WARNING: Food not found: ${qv.foodName}`);
    continue;
  }
  const totalCal = Math.round(food.calories * qv.multiplier);
  const mult = qv.multiplier;
  const isInt = Number.isInteger(mult);
  const bk = isInt
    ? `${mult} x ${food.name} (${food.calories}kcal c/u) = ${totalCal}kcal`
    : `${food.name} ~${totalCal}kcal`;
  for (const inp of qv.inputs) {
    entries.push(entry(inp, totalCal, bk));
  }
}

// ============================================================
// SECTION 3: Combo meals (~300 entries)
// ============================================================

interface ComboEntry {
  inputs: string[];
  components: { name: string; cal: number; label: string }[];
}

function combo(inputs: string[], parts: [string, string][]): ComboEntry {
  const components = parts.map(([foodName, label]) => {
    const food = foodByName.get(foodName);
    if (!food) {
      console.warn(`WARNING: Food not found in combo: ${foodName}`);
      return { name: foodName, cal: 0, label };
    }
    return { name: food.name, cal: food.calories, label };
  });
  return { inputs, components };
}

const combos: ComboEntry[] = [
  // Classic Argentine combos
  combo(['milanesa con puré', 'milanga con puré', 'milanesa y puré de papas'], [
    ['Milanesa de carne', 'milanesa'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['milanesa con ensalada', 'milanga con ensalada'], [
    ['Milanesa de carne', 'milanesa'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['milanesa con papas fritas', 'milanga con papas fritas', 'milanesa y papas'], [
    ['Milanesa de carne', 'milanesa'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),
  combo(['milanesa napolitana con papas fritas', 'napo con papas'], [
    ['Milanesa napolitana', 'napo'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),
  combo(['milanesa napolitana con puré', 'napo con puré'], [
    ['Milanesa napolitana', 'napo'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['milanesa napolitana con ensalada', 'napo con ensalada'], [
    ['Milanesa napolitana', 'napo'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['milanesa de pollo con ensalada', 'milanga de pollo con ensalada'], [
    ['Milanesa de pollo', 'milanesa de pollo'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['milanesa de pollo con puré', 'milanga de pollo con puré'], [
    ['Milanesa de pollo', 'milanesa de pollo'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['milanesa de pollo con papas fritas'], [
    ['Milanesa de pollo', 'milanesa de pollo'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),
  combo(['dos milanesas con ensalada', '2 milanesas con ensalada'], [
    ['Milanesa de carne', 'milanesa x2'],
    ['Milanesa de carne', 'milanesa (2da)'],
    ['Ensalada simple', 'ensalada'],
  ]),

  // Asado combos
  combo(['asado con ensalada', 'asado y ensalada'], [
    ['Asado (costilla)', 'asado'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['asado con puré', 'asado y puré'], [
    ['Asado (costilla)', 'asado'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['choripán y coca', 'chori y coca'], [
    ['Choripán', 'choripán'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['choripán y cerveza', 'chori y birra'], [
    ['Choripán', 'choripán'],
    ['Cerveza', 'cerveza'],
  ]),

  // Cafe combos
  combo(['café con leche y dos medialunas', 'café con dos medialunas', 'cortado con dos medialunas'], [
    ['Café con leche', 'café con leche'],
    ['Medialunas', 'medialuna'],
    ['Medialunas', 'medialuna'],
  ]),
  combo(['café con leche y tres medialunas', 'café con tres medialunas'], [
    ['Café con leche', 'café con leche'],
    ['Medialunas', 'medialuna'],
    ['Medialunas', 'medialuna'],
    ['Medialunas', 'medialuna'],
  ]),
  combo(['café con leche y tostadas con mermelada', 'cortado con tostadas'], [
    ['Café con leche', 'café con leche'],
    ['Tostadas con mermelada', 'tostadas con mermelada'],
  ]),
  combo(['café con leche y tostadas con queso y dulce'], [
    ['Café con leche', 'café con leche'],
    ['Tostadas con queso y dulce', 'tostadas con queso y dulce'],
  ]),
  combo(['mate cocido y tostadas', 'mate cocido con tostadas'], [
    ['Mate cocido', 'mate cocido'],
    ['Tostadas con mermelada', 'tostadas con mermelada'],
  ]),
  combo(['café solo y medialuna', 'café y medialuna', 'espresso con medialuna'], [
    ['Café solo', 'café'],
    ['Medialunas', 'medialuna'],
  ]),
  combo(['submarino y facturas', 'submarino con facturas'], [
    ['Submarino', 'submarino'],
    ['Facturas (criollito)', 'factura'],
    ['Facturas (criollito)', 'factura'],
  ]),
  combo(['café latte y brownie', 'latte con brownie'], [
    ['Café latte', 'latte'],
    ['Brownie', 'brownie'],
  ]),

  // McDonald's combos
  combo(['big mac con papas medianas y coca', 'combo big mac'], [
    ['Big Mac', 'big mac'],
    ['Papas fritas McDonald\'s medianas', 'papas medianas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['big mac con papas grandes y coca', 'big mac agrandado'], [
    ['Big Mac', 'big mac'],
    ['Papas fritas McDonald\'s grandes', 'papas grandes'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['mcpollo con papas y coca', 'combo mcpollo'], [
    ['McPollo', 'mcpollo'],
    ['Papas fritas McDonald\'s medianas', 'papas medianas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['cuarto de libra con papas y coca', 'combo cuarto de libra'], [
    ['Cuarto de Libra con Queso', 'cuarto de libra'],
    ['Papas fritas McDonald\'s medianas', 'papas medianas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['triple mac con papas y coca', 'combo triple mac'], [
    ['Triple Mac', 'triple mac'],
    ['Papas fritas McDonald\'s medianas', 'papas medianas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['nuggets x10 con papas y coca', 'combo nuggets mc'], [
    ['McNuggets x10', 'nuggets x10'],
    ['Papas fritas McDonald\'s medianas', 'papas medianas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['mcnuggets x6 y coca', 'nuggets x6 con coca'], [
    ['McNuggets x6', 'nuggets x6'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['big mac y mcflurry', 'big mac con mcflurry de postre'], [
    ['Big Mac', 'big mac'],
    ['McFlurry', 'mcflurry'],
  ]),

  // Burger King combos
  combo(['whopper con papas y coca', 'combo whopper'], [
    ['Whopper', 'whopper'],
    ['Papas fritas Burger King medianas', 'papas bk'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['doble whopper con papas', 'doble whopper y papas'], [
    ['Doble Whopper', 'doble whopper'],
    ['Papas fritas Burger King medianas', 'papas bk'],
  ]),
  combo(['stacker con aros de cebolla', 'stacker bk con aros'], [
    ['Stacker BK', 'stacker'],
    ['Aros de cebolla BK', 'aros de cebolla'],
  ]),

  // Subway combos
  combo(['subway teriyaki con cookie', 'sub teriyaki y cookie'], [
    ['Subway Pollo Teriyaki 15cm', 'sub teriyaki'],
    ['Subway Cookie', 'cookie'],
  ]),
  combo(['subway teriyaki 30cm con coca', 'sub teriyaki grande y coca'], [
    ['Subway Pollo Teriyaki 30cm', 'sub teriyaki 30cm'],
    ['Coca Cola', 'coca'],
  ]),

  // KFC combos
  combo(['kfc sandwich con papas y coca', 'combo kfc sandwich'], [
    ['KFC Sándwich Crispy', 'sandwich kfc'],
    ['KFC Papas medianas', 'papas kfc'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['kfc pieza con papas', '1 pieza kfc con papas'], [
    ['KFC pieza de pollo original', 'pieza kfc'],
    ['KFC Papas medianas', 'papas kfc'],
  ]),

  // Wendy's combos
  combo(['wendys classic con papas y frosty', 'combo wendys classic'], [
    ['Wendy\'s Classic Single', 'wendys classic'],
    ['Wendy\'s Papas medianas', 'papas wendys'],
    ['Wendy\'s Frosty', 'frosty'],
  ]),

  // Pizza combos
  combo(['dos porciones de muzza y una coca', 'pizza y coca'], [
    ['Pizza muzzarella (porción)', 'porción muzza'],
    ['Pizza muzzarella (porción)', 'porción muzza'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['pizza con fainá', 'porción de pizza con fainá', 'muzza con fainá'], [
    ['Pizza muzzarella (porción)', 'porción muzza'],
    ['Fainá (porción)', 'fainá'],
  ]),
  combo(['dos porciones de fugazzeta y cerveza', 'fugazzeta y birra'], [
    ['Fugazzeta (porción)', 'fugazzeta'],
    ['Fugazzeta (porción)', 'fugazzeta'],
    ['Cerveza', 'cerveza'],
  ]),
  combo(['pizza y fernet', 'dos porciones de pizza y fernet'], [
    ['Pizza muzzarella (porción)', 'porción muzza'],
    ['Pizza muzzarella (porción)', 'porción muzza'],
    ['Fernet con coca', 'fernet'],
  ]),

  // Pasta combos
  combo(['fideos con tuco y ensalada', 'fideos y ensalada'], [
    ['Fideos con tuco', 'fideos con tuco'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['ravioles con salsa y pan', 'ravioles y pan'], [
    ['Ravioles con salsa', 'ravioles'],
    ['Pan francés', 'pan'],
  ]),
  combo(['ñoquis con salsa y ensalada', 'ñoquis y ensalada'], [
    ['Ñoquis con salsa', 'ñoquis'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['lasaña y ensalada', 'lasaña con ensalada mixta'], [
    ['Lasaña', 'lasaña'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),

  // Arroz combos
  combo(['arroz con pollo y ensalada'], [
    ['Arroz con pollo', 'arroz con pollo'],
    ['Ensalada simple', 'ensalada'],
  ]),

  // Meat combos
  combo(['bife de chorizo con ensalada', 'bife con ensalada mixta'], [
    ['Bife de chorizo', 'bife de chorizo'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['bife de chorizo con papas fritas', 'bife con papas'], [
    ['Bife de chorizo', 'bife de chorizo'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),
  combo(['bife de lomo con puré', 'lomo con puré'], [
    ['Bife de lomo', 'lomo'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['pechuga con arroz', 'pollo grillado con arroz', 'pechuga y arroz blanco'], [
    ['Pollo grillado (pechuga)', 'pechuga'],
    ['Arroz blanco', 'arroz'],
  ]),
  combo(['pechuga con ensalada', 'pollo grillado y ensalada'], [
    ['Pollo grillado (pechuga)', 'pechuga'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['suprema con puré', 'suprema y puré de papas'], [
    ['Suprema', 'suprema'],
    ['Puré de papas', 'puré'],
  ]),
  combo(['suprema con ensalada'], [
    ['Suprema', 'suprema'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['hamburguesa casera con papas fritas', 'hamburguesa y papas'], [
    ['Hamburguesa completa', 'hamburguesa completa'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),
  combo(['hamburguesa casera con papas y coca', 'hamburguesa completa con papas y coca'], [
    ['Hamburguesa completa', 'hamburguesa completa'],
    ['Papas fritas caseras', 'papas fritas'],
    ['Coca Cola', 'coca'],
  ]),

  // Sándwich combos
  combo(['tostado de jamón y queso con café con leche', 'tostado y café con leche'], [
    ['Tostado de jamón y queso', 'tostado'],
    ['Café con leche', 'café con leche'],
  ]),
  combo(['sándwich de milanesa con coca', 'milanga al pan y coca'], [
    ['Sándwich de milanesa', 'sanguche de mila'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['lomito y cerveza', 'lomito con birra'], [
    ['Lomito', 'lomito'],
    ['Cerveza', 'cerveza'],
  ]),
  combo(['lomito y papas fritas', 'lomito con papas'], [
    ['Lomito', 'lomito'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),

  // Tarta combos
  combo(['tarta de jamón y queso con ensalada', 'tarta jyq y ensalada'], [
    ['Tarta de jamón y queso', 'tarta jyq'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['tarta de verdura con ensalada mixta'], [
    ['Tarta de verdura', 'tarta de verdura'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),

  // Empanada combos
  combo(['tres empanadas y una coca', '3 empanadas y coca', 'empanadas con coca'], [
    ['Empanada de carne', 'empanada'],
    ['Empanada de carne', 'empanada'],
    ['Empanada de carne', 'empanada'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['cuatro empanadas y cerveza', '4 empanadas y birra'], [
    ['Empanada de carne', 'empanada'],
    ['Empanada de carne', 'empanada'],
    ['Empanada de carne', 'empanada'],
    ['Empanada de carne', 'empanada'],
    ['Cerveza', 'cerveza'],
  ]),
  combo(['docena de empanadas', '12 empanadas', 'una docena de empanadas de carne'], [
    ['Empanada de carne', 'empanada x12'],
  ]),

  // Guiso / locro combos
  combo(['guiso de lentejas y pan', 'guiso con pan'], [
    ['Guiso de lentejas', 'guiso de lentejas'],
    ['Pan francés', 'pan'],
  ]),
  combo(['locro y vino tinto', 'locro con un vino'], [
    ['Locro', 'locro'],
    ['Vino tinto', 'vino'],
  ]),

  // Starbucks combos
  combo(['latte starbucks y muffin', 'starbucks latte con muffin'], [
    ['Starbucks Latte Grande', 'latte starbucks'],
    ['Starbucks Muffin', 'muffin starbucks'],
  ]),
  combo(['frappuccino mocha y croissant starbucks', 'frappe starbucks con croissant'], [
    ['Starbucks Frappuccino Mocha', 'frappuccino mocha'],
    ['Starbucks Croissant', 'croissant starbucks'],
  ]),

  // Havanna combos
  combo(['café havanna y alfajor havanna', 'havanna café y alfajor'], [
    ['Havanna café con leche', 'café havanna'],
    ['Alfajor Havanna chocolate', 'alfajor havanna'],
  ]),
  combo(['havanna medialuna con café', 'medialuna havanna y café'], [
    ['Havanna medialuna con jamón y queso', 'medialuna havanna'],
    ['Havanna café con leche', 'café havanna'],
  ]),

  // Fish combos
  combo(['filet de merluza con ensalada', 'merluza con ensalada'], [
    ['Filet de merluza', 'filet de merluza'],
    ['Ensalada simple', 'ensalada'],
  ]),
  combo(['salmón con arroz', 'salmon y arroz blanco'], [
    ['Salmón', 'salmón'],
    ['Arroz blanco', 'arroz'],
  ]),

  // Desayuno completos
  combo(['yogur con granola y banana', 'yogur granola y banana'], [
    ['Yogur descremado', 'yogur descremado'],
    ['Granola', 'granola'],
    ['Banana', 'banana'],
  ]),
  combo(['avena con banana y miel', 'porridge con banana'], [
    ['Avena', 'avena'],
    ['Banana', 'banana'],
    ['Miel', 'miel'],
  ]),
  combo(['tostada con palta y huevo', 'palta toast con huevo'], [
    ['Tostada con palta', 'tostada con palta'],
    ['Huevo frito', 'huevo frito'],
  ]),
  combo(['cereales con leche y banana', 'cereal con leche y banana'], [
    ['Cereales', 'cereales con leche'],
    ['Banana', 'banana'],
  ]),
  combo(['tostadas con queso y dulce de leche y café', 'desayuno completo'], [
    ['Tostadas con queso y dulce', 'tostadas'],
    ['Café con leche', 'café con leche'],
  ]),

  // Merienda
  combo(['mate con bizcochitos', 'mates y bizcochitos de grasa'], [
    ['Mate (amargo)', 'mate'],
    ['Bizcochitos de grasa', 'bizcochitos x3'],
    ['Bizcochitos de grasa', 'bizcochitos'],
    ['Bizcochitos de grasa', 'bizcochitos'],
  ]),
  combo(['mate y galletitas', 'mates con galletitas de agua'], [
    ['Mate (amargo)', 'mate'],
    ['Galletitas de agua', 'galletitas'],
  ]),
  combo(['té y tostadas con mermelada', 'té con tostadas'], [
    ['Té', 'té'],
    ['Tostadas con mermelada', 'tostadas con mermelada'],
  ]),

  // Asado completo
  combo(['choripán y morcipán', 'chori y morci'], [
    ['Choripán', 'choripán'],
    ['Morcipán', 'morcipán'],
  ]),
  combo(['asado con provoleta y ensalada', 'asado completo con provoleta'], [
    ['Asado (costilla)', 'asado'],
    ['Provoleta', 'provoleta'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['vacío con ensalada mixta', 'vacío y ensalada'], [
    ['Vacío', 'vacío'],
    ['Ensalada mixta', 'ensalada mixta'],
  ]),
  combo(['bondiola con puré de calabaza', 'bondiola y puré de calabaza'], [
    ['Bondiola', 'bondiola'],
    ['Puré de calabaza', 'puré de calabaza'],
  ]),
  combo(['entraña con papas fritas', 'entraña y papas'], [
    ['Entraña', 'entraña'],
    ['Papas fritas caseras', 'papas fritas'],
  ]),

  // Snack combos
  combo(['papas lays y coca', 'papas de paquete con coca'], [
    ['Lays clásicas', 'lays clásicas'],
    ['Coca Cola', 'coca'],
  ]),
  combo(['doritos y coca', 'doritos con coca'], [
    ['Doritos', 'doritos'],
    ['Coca Cola', 'coca'],
  ]),

  // Postres combos
  combo(['flan con dulce de leche y crema', 'flan mixto'], [
    ['Flan con dulce de leche', 'flan con ddl'],
    // Just adding the cream difference - use flan con crema base minus flan base
  ]),
  combo(['panqueques con dulce de leche y helado', 'panqueques y helado'], [
    ['Panqueques con dulce de leche', 'panqueques con ddl'],
    ['Helado 1 bocha', 'bocha de helado'],
  ]),

  // Ensalada combos
  combo(['ensalada césar con jugo de naranja', 'cesar y jugo'], [
    ['Ensalada César', 'ensalada césar'],
    ['Jugo de naranja', 'jugo de naranja'],
  ]),

  // Wok combos
  combo(['wok de pollo con arroz', 'wok pollo y arroz'], [
    ['Wok de pollo', 'wok de pollo'],
    ['Arroz blanco', 'arroz'],
  ]),
  combo(['wok de carne con arroz', 'wok carne y arroz'], [
    ['Wok de carne', 'wok de carne'],
    ['Arroz blanco', 'arroz'],
  ]),

  // Burrito combo
  combo(['burrito y coca', 'burrito con coca cola'], [
    ['Burrito', 'burrito'],
    ['Coca Cola', 'coca'],
  ]),

  // Sushi combos
  combo(['dos rolls de sushi y cerveza', 'sushi y birra'], [
    ['Sushi roll (8 piezas)', 'roll de sushi'],
    ['Sushi roll (8 piezas)', 'roll de sushi'],
    ['Cerveza', 'cerveza'],
  ]),

  // Polenta combos
  combo(['polenta con tuco', 'polenta y salsa'], [
    ['Polenta', 'polenta'],
  ]),
  combo(['polenta con salsa y queso', 'polenta con queso'], [
    ['Polenta', 'polenta'],
    ['Queso rallado', 'queso rallado'],
  ]),

  // Pizza Hut combos
  combo(['pizza hut pepperoni con breadsticks', 'pepperoni pizza hut y palitos'], [
    ['Pizza Hut Pepperoni (porción)', 'porción pepperoni'],
    ['Pizza Hut Breadsticks', 'breadsticks'],
  ]),

  // Mostaza combos
  combo(['combo mostaza clasica con papas', 'mostaza clasica y papas'], [
    ['Hamburguesa Mostaza Clásica', 'mostaza clasica'],
    ['Papas fritas Mostaza', 'papas mostaza'],
  ]),

  // Paty combo
  combo(['dos patys con pan y coca', 'hamburguesa paty doble con coca'], [
    ['Hamburguesa Paty Doble', 'paty doble'],
    ['Pan de hamburguesa Bimbo', 'pan de hamburguesa'],
    ['Coca Cola', 'coca'],
  ]),

  // Egg combos
  combo(['omelette con tostadas', 'omelette y tostadas'], [
    ['Omelette', 'omelette'],
    ['Tostadas', 'tostada'],
    ['Tostadas', 'tostada'],
  ]),
  combo(['huevos revueltos con tostadas y café', 'desayuno huevos revueltos'], [
    ['Huevo revuelto', 'huevo revuelto'],
    ['Huevo revuelto', 'huevo revuelto'],
    ['Tostadas', 'tostada x2'],
    ['Tostadas', 'tostada'],
    ['Café con leche', 'café con leche'],
  ]),

  // Licuado combo
  combo(['licuado de banana y tostadas con queso', 'licuado y tostadas'], [
    ['Licuado de banana', 'licuado'],
    ['Tostadas con queso y dulce', 'tostadas con queso y dulce'],
  ]),

  // Matambre combos
  combo(['matambre a la pizza con ensalada', 'matambre pizza y ensalada'], [
    ['Matambre a la pizza', 'matambre a la pizza'],
    ['Ensalada simple', 'ensalada'],
  ]),
];

// Special handling for docena de empanadas
for (const c of combos) {
  if (c.inputs.includes('docena de empanadas')) {
    const empCal = foodByName.get('Empanada de carne')!.calories;
    const totalCal = empCal * 12;
    const bk = `12 empanadas de carne (${empCal}kcal c/u) = ${totalCal}kcal`;
    for (const inp of c.inputs) {
      entries.push(entry(inp, totalCal, bk));
    }
    continue;
  }

  const totalCal = c.components.reduce((sum, comp) => sum + comp.cal, 0);
  const bkParts = c.components.map(comp => `${comp.label} ~${comp.cal}kcal`);
  const bk = bkParts.join(' + ');

  for (const inp of c.inputs) {
    entries.push(entry(inp, totalCal, bk));
  }
}

// ============================================================
// SECTION 4: Casual/colloquial variations (~200 entries)
// ============================================================

interface CasualEntry {
  inputs: string[];
  foodName: string;
  customBreakdown?: string;
}

const casualEntries: CasualEntry[] = [
  // Milanesas
  { inputs: ['una mila', 'mila de carne', 'una milanga'], foodName: 'Milanesa de carne' },
  { inputs: ['una mila napo', 'milanga napo', 'napo'], foodName: 'Milanesa napolitana' },
  { inputs: ['mila de pollo', 'milanga de pollo'], foodName: 'Milanesa de pollo' },
  { inputs: ['mila a caballo', 'milanga a caballo'], foodName: 'Milanesa a caballo' },

  // Café
  { inputs: ['un cortado', 'cortado'], foodName: 'Café con leche' },
  { inputs: ['un café', 'cafecito', 'un cafecito', 'espresso'], foodName: 'Café solo' },
  { inputs: ['un latte', 'cafe latte'], foodName: 'Café latte' },

  // McDonald's casual
  { inputs: ['un mc', 'un mcpollo'], foodName: 'McPollo' },
  { inputs: ['un big mac', 'bigmac'], foodName: 'Big Mac' },
  { inputs: ['unas papas de mc', 'papas del mc', 'papas mcdonald', 'papas mc medianas'], foodName: 'Papas fritas McDonald\'s medianas' },
  { inputs: ['un mcflurry', 'flurry'], foodName: 'McFlurry' },
  { inputs: ['nuggets del mc', 'cajita de nuggets', 'nuggets x6'], foodName: 'McNuggets x6' },
  { inputs: ['un sundae', 'sundae del mc'], foodName: 'Sundae' },

  // Birra / fernet
  { inputs: ['birra', 'una birra', 'una lata'], foodName: 'Cerveza' },
  { inputs: ['una pinta', 'pinta de birra', 'una pinta artesanal'], foodName: 'Cerveza pinta' },
  { inputs: ['un fernet', 'ferne', 'un fernecito', 'fernecito'], foodName: 'Fernet con coca' },
  { inputs: ['una quilmes', 'quilmes lata'], foodName: 'Quilmes Lata 473ml' },
  { inputs: ['una stella', 'stella lata'], foodName: 'Stella Artois Lata 473ml' },
  { inputs: ['una corona', 'corona porron'], foodName: 'Corona 355ml' },
  { inputs: ['una patagonia', 'patagonia ipa'], foodName: 'Patagonia IPA' },

  // Alfajores
  { inputs: ['un guayma', 'guaymallon', 'guaymallén triple'], foodName: 'Guaymallén triple' },
  { inputs: ['un guayma simple', 'guaymallen simple'], foodName: 'Guaymallén Simple' },
  { inputs: ['un havanna', 'alfajor havanna'], foodName: 'Alfajor Havanna chocolate' },
  { inputs: ['un cachafaz', 'cachafaz triple'], foodName: 'Cachafaz Triple' },
  { inputs: ['un capitan del espacio', 'capitán del espacio'], foodName: 'Capitán del Espacio' },
  { inputs: ['un jorgito', 'jorgito negro'], foodName: 'Jorgito Negro' },
  { inputs: ['una tita', 'tita'], foodName: 'Tita' },
  { inputs: ['un rasta', 'rasta simple'], foodName: 'Rasta Simple' },
  { inputs: ['un tofi'], foodName: 'Tofi' },
  { inputs: ['un suchard'], foodName: 'Suchard' },
  { inputs: ['un milka', 'alfajor milka'], foodName: 'Milka Alfajor' },
  { inputs: ['un chocoarroz', 'alfajor de arroz'], foodName: 'Chocoarroz' },
  { inputs: ['un fulbito'], foodName: 'Fulbito' },
  { inputs: ['un fantoche'], foodName: 'Fantoche' },
  { inputs: ['un vauquita'], foodName: 'Vauquita' },
  { inputs: ['un dos corazones'], foodName: 'Dos Corazones' },
  { inputs: ['un tatín'], foodName: 'Tatín' },
  { inputs: ['alfajor ser', 'ser alfajor', 'alfajor light'], foodName: 'Ser Alfajor' },

  // Chocolates
  { inputs: ['una milka', 'barra de milka', 'chocolate milka'], foodName: 'Milka chocolate' },
  { inputs: ['un bonobon', 'bon o bon', 'un bon o bon'], foodName: 'Bon o Bon' },
  { inputs: ['una rhodesia', 'oblea rhodesia'], foodName: 'Rhodesia' },
  { inputs: ['un shot', 'shot felfort'], foodName: 'Shot' },
  { inputs: ['un cabsha'], foodName: 'Cabsha' },
  { inputs: ['un kinder bueno', 'kinder bueno'], foodName: 'Kinder Bueno' },
  { inputs: ['un snickers'], foodName: 'Snickers' },
  { inputs: ['un nucrem', 'nucrem'], foodName: 'Nucrem' },
  { inputs: ['rocklets', 'un paquete de rocklets'], foodName: 'Rocklets' },
  { inputs: ['mantecol', 'un mantecol'], foodName: 'Mantecol' },

  // Galletitas
  { inputs: ['unas toddy', 'galletitas toddy', 'toddy'], foodName: 'Galletitas Toddy' },
  { inputs: ['unas oreo', 'oreos', 'paquete de oreo'], foodName: 'Galletitas Oreo' },
  { inputs: ['unas pepitos', 'pepitos'], foodName: 'Galletitas Pepitos' },
  { inputs: ['chocolinas', 'unas chocolinas'], foodName: 'Chocolinas' },
  { inputs: ['pitusas', 'unas pitusas'], foodName: 'Pitusas Chocolate' },
  { inputs: ['criollitas', 'galletitas criollitas'], foodName: 'Galletitas Criollitas' },

  // Pizza
  { inputs: ['una porción de muzza', 'porción de pizza', 'una muzza'], foodName: 'Pizza muzzarella (porción)' },
  { inputs: ['una fugazza', 'fugazza con queso', 'fugazzeta'], foodName: 'Fugazzeta (porción)' },
  { inputs: ['un fainá', 'fainá'], foodName: 'Fainá (porción)' },
  { inputs: ['una prepizza', 'prepizza casera'], foodName: 'Prepizza' },

  // Sándwiches casual
  { inputs: ['un tostado', 'tostado jyq'], foodName: 'Tostado de jamón y queso' },
  { inputs: ['un pancho', 'pancho'], foodName: 'Pancho' },
  { inputs: ['un lomito', 'lomito completo'], foodName: 'Lomito' },
  { inputs: ['sanguche de mila', 'milanga al pan', 'un sanguchito de milanga'], foodName: 'Sándwich de milanesa' },
  { inputs: ['un pebete', 'pebete jyq'], foodName: 'Pebete de jamón y queso' },

  // Bebidas casual
  { inputs: ['una coca', 'coca cola', 'un vaso de coca'], foodName: 'Coca Cola' },
  { inputs: ['coca zero', 'coca sin azucar', 'coca light'], foodName: 'Coca Cola Zero' },
  { inputs: ['una sprite', 'sprite'], foodName: 'Sprite' },
  { inputs: ['una fanta'], foodName: 'Fanta' },
  { inputs: ['un gatorade', 'gatorade'], foodName: 'Gatorade' },
  { inputs: ['un speed', 'speed energy'], foodName: 'Speed energizante' },
  { inputs: ['un monster', 'monster energy'], foodName: 'Monster Energy' },
  { inputs: ['un red bull', 'redbull'], foodName: 'Red Bull' },
  { inputs: ['un levité', 'agua saborizada'], foodName: 'Levité' },
  { inputs: ['una chocolatada', 'cindor', 'leche chocolatada'], foodName: 'Cindor' },
  { inputs: ['un juguito', 'jugo de caja', 'cepita', 'baggio'], foodName: 'Jugo en caja' },
  { inputs: ['unos mates', 'mate amargo', 'mates'], foodName: 'Mate (amargo)' },
  { inputs: ['un gancia', 'gancia con sprite'], foodName: 'Gancia' },
  { inputs: ['un campari', 'campari con naranja'], foodName: 'Campari con naranja' },
  { inputs: ['un spritz', 'aperol spritz', 'aperol'], foodName: 'Aperol Spritz' },
  { inputs: ['un vino', 'copa de vino', 'copa de tinto'], foodName: 'Vino tinto' },

  // Empanadas casual
  { inputs: ['una empa', 'una empanada', 'empa de carne'], foodName: 'Empanada de carne' },

  // Helados casual
  { inputs: ['una bocha', 'bocha de helado'], foodName: 'Helado 1 bocha' },
  { inputs: ['un cuarto de helado', 'cuarto de helado', 'cuarto kilo helado'], foodName: 'Helado 1/4 kg' },
  { inputs: ['medio kilo de helado', 'medio de helado'], foodName: 'Helado 1/2 kg' },
  { inputs: ['cucurucho grido', 'un cucurucho de grido'], foodName: 'Grido cucurucho' },

  // Comida casual
  { inputs: ['un chori', 'un choripán', 'choripan'], foodName: 'Choripán' },
  { inputs: ['provoleta', 'una provo'], foodName: 'Provoleta' },
  { inputs: ['una hamburguesa', 'hamburguesa casera'], foodName: 'Hamburguesa casera' },
  { inputs: ['una hamburguesa completa', 'burger completa'], foodName: 'Hamburguesa completa' },
  { inputs: ['un whopper', 'whopper bk'], foodName: 'Whopper' },
  { inputs: ['un stacker', 'stacker de bk'], foodName: 'Stacker BK' },

  // Postres casual
  { inputs: ['un flan', 'un flancito'], foodName: 'Flan' },
  { inputs: ['un flan con ddl', 'flan con dulce de leche', 'flan ddl'], foodName: 'Flan con dulce de leche' },
  { inputs: ['un brownie'], foodName: 'Brownie' },
  { inputs: ['una porción de torta', 'torta', 'un pedazo de torta'], foodName: 'Torta (porción)' },
  { inputs: ['churros', 'unos churros'], foodName: 'Churros' },
  { inputs: ['un cheesecake', 'porción de cheesecake'], foodName: 'Cheesecake (porción)' },
  { inputs: ['un tiramisú', 'tiramisu'], foodName: 'Tiramisú' },

  // Yogures casual
  { inputs: ['un ser', 'yogur ser', 'yogurcito ser'], foodName: 'Yogur Ser firme' },
  { inputs: ['un yogurisimo', 'yogurísimo'], foodName: 'Yogurísimo entero' },
  { inputs: ['un danette', 'danette de chocolate'], foodName: 'Danette chocolate' },
  { inputs: ['un danonino', 'dino'], foodName: 'Danonino' },
  { inputs: ['un serenito', 'serenito'], foodName: 'Serenito chocolate' },
  { inputs: ['un actimel'], foodName: 'Actimel clásico' },
  { inputs: ['un activia', 'yogur activia'], foodName: 'Yogur Activia natural' },

  // Pan casual
  { inputs: ['un vigilante', 'queso y dulce'], foodName: 'Vigilante (queso y dulce)' },
  { inputs: ['bizcochitos', 'bizcochitos de grasa'], foodName: 'Bizcochitos de grasa' },

  // Snacks casual
  { inputs: ['unas papitas', 'papitas de paquete', 'unas lays'], foodName: 'Lays clásicas' },
  { inputs: ['unos doritos', 'doritos'], foodName: 'Doritos' },
  { inputs: ['chizitos', 'cheetos'], foodName: 'Chizitos' },
  { inputs: ['pringles', 'tubo de pringles'], foodName: 'Pringles' },
  { inputs: ['saladix', 'saladix de pizza'], foodName: 'Saladix Pizza' },
  { inputs: ['palitos', 'palitos salados'], foodName: 'Palitos salados' },
  { inputs: ['conitos', '3d conitos'], foodName: 'Conitos' },
  { inputs: ['tutucas'], foodName: 'Tutucas' },

  // Subway casual
  { inputs: ['un sub', 'un subway', 'sub chico'], foodName: 'Subway Pollo Teriyaki 15cm' },
  { inputs: ['un sub grande', 'subway grande', 'sub de 30'], foodName: 'Subway Pollo Teriyaki 30cm' },

  // Starbucks casual
  { inputs: ['un frappe', 'frappuccino', 'frappe de starbucks'], foodName: 'Starbucks Frappuccino Mocha' },
  { inputs: ['un latte de starbucks', 'starbucks latte'], foodName: 'Starbucks Latte Grande' },
  { inputs: ['flat white', 'un flat white'], foodName: 'Starbucks Flat White' },

  // Fiambres casual
  { inputs: ['unas fetas de jamon', 'jamón cocido', 'jamon'], foodName: 'Jamón cocido' },
  { inputs: ['panceta', 'bacon', 'panceta frita'], foodName: 'Panceta / Bacon' },
  { inputs: ['salame', 'unas rodajas de salame'], foodName: 'Salame' },

  // Frutas casual
  { inputs: ['una manzana', 'manzana'], foodName: 'Manzana' },
  { inputs: ['una banana', 'banana'], foodName: 'Banana' },
  { inputs: ['una naranja', 'naranja'], foodName: 'Naranja' },
  { inputs: ['una mandarina', 'mandarina'], foodName: 'Mandarina' },
  { inputs: ['una palta', 'media palta', 'palta'], foodName: 'Palta' },

  // Caseros casual
  { inputs: ['polenta', 'un plato de polenta'], foodName: 'Polenta' },
  { inputs: ['unos ñoquis', 'ñoquis', 'ñoquis del 29'], foodName: 'Ñoquis con salsa' },
  { inputs: ['ravioles', 'unos ravioles'], foodName: 'Ravioles con salsa' },
  { inputs: ['lasaña', 'una porción de lasaña'], foodName: 'Lasaña' },
  { inputs: ['canelones', 'unos canelones'], foodName: 'Canelones' },
  { inputs: ['fideos', 'un plato de fideos'], foodName: 'Fideos con tuco' },
  { inputs: ['guiso', 'un guiso'], foodName: 'Guiso de lentejas' },
  { inputs: ['locro', 'un locro'], foodName: 'Locro' },
  { inputs: ['puchero', 'un puchero'], foodName: 'Puchero' },

  // Extras
  { inputs: ['mayo', 'cucharada de mayo'], foodName: 'Mayonesa' },
  { inputs: ['nutella', 'cucharada de nutella'], foodName: 'Nutella' },
  { inputs: ['pasta de maní', 'cucharada de pasta de maní', 'peanut butter'], foodName: 'Pasta de maní' },
  { inputs: ['dulce de leche', 'cucharada de dulce de leche'], foodName: 'Dulce de leche' },
  { inputs: ['casancrem', 'queso untable'], foodName: 'Casancrem original' },

  // Marcas as people say them
  { inputs: ['una paty', 'hamburguesa paty', 'paty'], foodName: 'Hamburguesa Paty Clásica' },
  { inputs: ['una swift', 'hamburguesa swift'], foodName: 'Hamburguesa Swift' },
  { inputs: ['nuggets granja del sol', 'nuggets congelados'], foodName: 'Nuggets Granja del Sol' },
  { inputs: ['patitas', 'patitas de pollo'], foodName: 'Patitas de pollo Granja del Sol' },
  { inputs: ['papa mccain', 'papas mccain', 'mccain'], foodName: 'Papas fritas congeladas McCain' },

  // Chipá
  { inputs: ['un chipá', 'chipá', 'chipacito'], foodName: 'Chipá' },

  // Calditos
  { inputs: ['caldito knorr', 'caldo de verdura', 'cubito'], foodName: 'Caldo en cubo' },
];

for (const ce of casualEntries) {
  const food = foodByName.get(ce.foodName);
  if (!food) {
    console.warn(`WARNING: Food not found (casual): ${ce.foodName}`);
    continue;
  }
  const bk = ce.customBreakdown || `${food.name} ~${food.calories}kcal (${food.serving_size})`;
  for (const inp of ce.inputs) {
    entries.push(entry(inp, food.calories, bk));
  }
}

// ============================================================
// SECTION 5: Additional keyword-based natural variations
// For foods where the first keyword doesn't capture a natural phrase,
// add alternate natural language inputs
// ============================================================

const additionalNatural: { foodName: string; inputs: string[] }[] = [
  { foodName: 'Milanesa de carne', inputs: ['una milanesa de carne', 'milanesa de ternera'] },
  { foodName: 'Milanesa de pollo', inputs: ['una milanesa de pollo'] },
  { foodName: 'Milanesa napolitana', inputs: ['una milanesa napolitana', 'napolitana de carne'] },
  { foodName: 'Bife de chorizo', inputs: ['un bife de chorizo', 'bife'] },
  { foodName: 'Bife de lomo', inputs: ['un bife de lomo', 'lomito de carne'] },
  { foodName: 'Pollo grillado (pechuga)', inputs: ['pechuga grillada', 'una pechuga de pollo', 'pollo a la plancha'] },
  { foodName: 'Pollo al horno (muslo)', inputs: ['un muslo de pollo', 'pata muslo'] },
  { foodName: 'Asado (costilla)', inputs: ['asado de costilla', 'tira de asado', 'costillar'] },
  { foodName: 'Hamburguesa completa', inputs: ['una hamburguesa con queso y pan', 'cheeseburger casera'] },
  { foodName: 'Cerdo al horno', inputs: ['carré de cerdo', 'carne de cerdo al horno'] },
  { foodName: 'Fideos con tuco', inputs: ['un plato de fideos con tuco', 'fideos con salsa de tomate'] },
  { foodName: 'Ñoquis con salsa', inputs: ['un plato de ñoquis', 'ñoquis con tuco'] },
  { foodName: 'Ravioles con salsa', inputs: ['un plato de ravioles', 'ravioles de ricota'] },
  { foodName: 'Fideos con bolognesa', inputs: ['fideos boloñesa', 'fideos con carne'] },
  { foodName: 'Arroz blanco', inputs: ['un poco de arroz', 'arroz hervido'] },
  { foodName: 'Guiso de lentejas', inputs: ['un plato de guiso', 'guiso casero'] },
  { foodName: 'Empanada de carne', inputs: ['una empanada de carne', 'empanada criolla'] },
  { foodName: 'Pizza muzzarella (porción)', inputs: ['una porción', 'porción de pizza muzza'] },
  { foodName: 'Tarta de jamón y queso', inputs: ['una porción de tarta', 'tarta jamon queso'] },
  { foodName: 'Tostado de jamón y queso', inputs: ['un tostado de jamon y queso', 'tostado jamon queso'] },
  { foodName: 'Sándwich de milanesa', inputs: ['un sanguche de milanesa', 'milanga al pan'] },
  { foodName: 'Café con leche', inputs: ['un café con leche', 'café con leche'] },
  { foodName: 'Coca Cola 500ml', inputs: ['una coca de medio litro', 'coca 500'] },
  { foodName: 'Yogur Ser firme', inputs: ['yogur ser firme', 'un yogur ser'] },
  { foodName: 'Dulce de leche', inputs: ['una cucharada de ddl'] },
  { foodName: 'Medialunas', inputs: ['una medialuna', 'medialuna de manteca'] },
  { foodName: 'Ensalada simple', inputs: ['ensalada verde', 'un plato de ensalada'] },
  { foodName: 'Ensalada mixta', inputs: ['ensalada completa', 'ensalada con tomate'] },
  { foodName: 'Puré de papas', inputs: ['un puré', 'puré de papa'] },
  { foodName: 'Papas fritas caseras', inputs: ['papas fritas', 'un plato de papas fritas'] },
  { foodName: 'Huevo frito', inputs: ['un huevo frito'] },
  { foodName: 'Huevo revuelto', inputs: ['un huevo revuelto', 'huevos scrambled'] },
  { foodName: 'Huevo duro', inputs: ['un huevo duro', 'huevo hervido'] },
  { foodName: 'Alfajor simple', inputs: ['un alfajor', 'alfajor de maicena'] },
  { foodName: 'Alfajor triple', inputs: ['un alfajor triple'] },
  { foodName: 'Alfajor de arroz', inputs: ['un alfajor de arroz'] },
  { foodName: 'Chocolate', inputs: ['una barra de chocolate', 'tableta de chocolate'] },
  { foodName: 'Barra de cereal', inputs: ['una barrita de cereal', 'barrita'] },
  { foodName: 'Helado 1 bocha', inputs: ['una bocha de helado'] },
  { foodName: 'Flan', inputs: ['un flan casero'] },
  { foodName: 'Panqueques con dulce de leche', inputs: ['panqueques con ddl', 'unos panqueques'] },
  { foodName: 'Facturas (criollito)', inputs: ['una factura', 'un criollito', 'un sacramento'] },
  { foodName: 'Tortilla de papas', inputs: ['tortilla española', 'tortilla de papa'] },
  { foodName: 'Sushi roll (8 piezas)', inputs: ['un roll de sushi', 'sushi roll'] },
  { foodName: 'Wrap de pollo', inputs: ['un wrap', 'wrap de pollo'] },
  { foodName: 'Suprema', inputs: ['una suprema', 'suprema de pollo'] },
  { foodName: 'Omelette', inputs: ['un omelette', 'tortilla de huevo'] },
  { foodName: 'Calzone', inputs: ['un calzone'] },
  { foodName: 'Burrito', inputs: ['un burrito'] },
  { foodName: 'Revuelto Gramajo', inputs: ['gramajo', 'un gramajo'] },
  { foodName: 'Vitel toné', inputs: ['vitel toné', 'un vitel toné'] },
  { foodName: 'Puchero', inputs: ['un puchero criollo'] },
  { foodName: 'Mondongo', inputs: ['un mondongo', 'buseca'] },
  { foodName: 'Carbonada', inputs: ['una carbonada', 'carbonada criolla'] },
  { foodName: 'Estofado', inputs: ['un estofado', 'estofado de carne'] },
  { foodName: 'Matambre a la pizza', inputs: ['matambre tirado a la pizza'] },
  { foodName: 'Pastel de papa', inputs: ['un pastel de papas', 'pastel de carne'] },
  { foodName: 'Arroz con leche', inputs: ['un arroz con leche'] },
  { foodName: 'Ensalada de frutas', inputs: ['una ensalada de frutas', 'macedonea de frutas'] },
  { foodName: 'Zapallitos rellenos', inputs: ['zapallitos rellenos', 'dos zapallitos rellenos'] },
  { foodName: 'Licuado de banana', inputs: ['un licuado', 'licuado de banana'] },
  { foodName: 'Leche chocolatada La Serenísima', inputs: ['chocolatada serenísima', 'leche chocolatada serenísima'] },
  { foodName: 'Tostada con palta', inputs: ['tostada de palta', 'pan con palta', 'palta toast'] },
];

for (const an of additionalNatural) {
  const food = foodByName.get(an.foodName);
  if (!food) {
    console.warn(`WARNING: Food not found (additional): ${an.foodName}`);
    continue;
  }
  const bk = `${food.name} ~${food.calories}kcal (${food.serving_size})`;
  for (const inp of an.inputs) {
    entries.push(entry(inp, food.calories, bk));
  }
}

// ============================================================
// Write output
// ============================================================

const outputPath = path.join(__dirname, 'dataset.jsonl');
const lines = entries.map(e => JSON.stringify(e));
fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');

console.log(`Generated ${entries.length} training entries`);
console.log(`Output: ${outputPath}`);

// Count per section (approximate)
const directCount = FOOD_SEED_DATA.length;
console.log(`\nBreakdown:`);
console.log(`  Section 1 (Direct from DB): ~${directCount}`);
console.log(`  Total entries: ${entries.length}`);
