import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const newDb = new PrismaClient({
  datasourceUrl: "postgresql://transit_tn_db_user:gmom6ZQnDGjZViRPzboljBzfW0NFGap1@dpg-d82b4qpkh4rs73c2ua80-a.frankfurt-postgres.render.com/transit_tn_db"
});

const oldDb = new PrismaClient({
  datasourceUrl: "postgresql://transituser:transitpassword@transit-tn.tn:5434/transitdb"
});

async function fix() {
  const trans = await oldDb.$queryRaw`SELECT * FROM "TransporterTrip"`;
  console.log(`📦 Fixing ${trans.length} transporter trips...`);
  
  for (const tr of trans) {
    await newDb.transporterTrip.upsert({
      where: { tripId: tr.tripId },
      update: {
        contactInfo: tr.contactInfo,
        vehicleType: tr.vehicleType,
        availableSpace: tr.availableSpace,
        eta: tr.eta,
        route: tr.route
      },
      create: {
        tripId: tr.tripId,
        contactInfo: tr.contactInfo,
        vehicleType: tr.vehicleType,
        availableSpace: tr.availableSpace,
        eta: tr.eta,
        route: tr.route
      }
    });
  }

  console.log('✅ All transporter trips fixed!');
  await oldDb.$disconnect();
  await newDb.$disconnect();
}

fix().catch(console.error);
