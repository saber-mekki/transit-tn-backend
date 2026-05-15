import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const newDb = new PrismaClient({
  datasourceUrl: "postgresql://transit_tn_db_user:gmom6ZQnDGjZViRPzboljBzfW0NFGap1@dpg-d82b4qpkh4rs73c2ua80-a.frankfurt-postgres.render.com/transit_tn_db"
});

const oldDb = new PrismaClient({
  datasourceUrl: "postgresql://transituser:transitpassword@transit-tn.tn:5434/transitdb"
});

async function fix() {
  // Check what fields old TransporterTrip actually has
  const trans = await oldDb.$queryRaw`SELECT * FROM "TransporterTrip" LIMIT 3`;
  console.log('Old fields:', Object.keys(trans[0]));
  console.log('Sample:', trans[0]);

  await oldDb.$disconnect();
  await newDb.$disconnect();
}

fix().catch(console.error);
