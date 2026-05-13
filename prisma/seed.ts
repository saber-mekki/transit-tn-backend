import { PrismaClient, UserRole, TransportType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Transit TN database...');

  // Clear existing data in correct order
  await prisma.notification.deleteMany();
  await prisma.louageTrip.deleteMany();
  await prisma.busTrip.deleteMany();
  await prisma.transporterTrip.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.station.deleteMany();
  await prisma.user.deleteMany();

  // ─── STATIONS ───────────────────────────────────
  console.log('📍 Seeding stations...');
  const stations = await Promise.all([
    prisma.station.create({ data: { name: 'Moncef Bey (Sud)', city: 'Tunis', lat: 36.792, lng: 10.183 } }),
    prisma.station.create({ data: { name: 'Bab Saadoun (Nord)', city: 'Tunis', lat: 36.804, lng: 10.163 } }),
    prisma.station.create({ data: { name: 'Station Louage Sousse', city: 'Sousse', lat: 35.825, lng: 10.641 } }),
    prisma.station.create({ data: { name: 'Sidi Mansour', city: 'Sfax', lat: 34.739, lng: 10.759 } }),
    prisma.station.create({ data: { name: 'Station Louage Gabès', city: 'Gabès', lat: 33.881, lng: 10.098 } }),
    prisma.station.create({ data: { name: 'Station Louage Nabeul', city: 'Nabeul', lat: 36.456, lng: 10.734 } }),
    prisma.station.create({ data: { name: 'Station Louage Bizerte', city: 'Bizerte', lat: 37.270, lng: 9.863 } }),
    prisma.station.create({ data: { name: 'Station Louage Gafsa', city: 'Gafsa', lat: 34.425, lng: 8.785 } }),
  ]);
  const [moncefBey, babSaadoun, sousse, sfax, gabes, nabeul, bizerte, gafsa] = stations;

  // ─── USERS ──────────────────────────────────────
  console.log('👤 Seeding users...');
  const adminPwd = await bcrypt.hash('Admin@123!', 12);
  const opPwd    = await bcrypt.hash('Operator@123!', 12);
  const userPwd  = await bcrypt.hash('User@123!', 12);

  const admin = await prisma.user.create({
    data: { username: 'admin', password: adminPwd, displayName: 'Admin User', role: UserRole.ADMIN, email: 'admin@transit-tn.com' }
  });
  const op1 = await prisma.user.create({
    data: { username: 'sfax_express', password: opPwd, displayName: 'Sfax Express', role: UserRole.OPERATOR, phone: '+21698123456' }
  });
  const op2 = await prisma.user.create({
    data: { username: 'rapid_sud', password: opPwd, displayName: 'Rapid Sud', role: UserRole.OPERATOR, phone: '+21622456789' }
  });
  const op3 = await prisma.user.create({
    data: { username: 'sntri', password: opPwd, displayName: 'SNTRI', role: UserRole.OPERATOR }
  });
  await prisma.user.create({
    data: { username: 'ahmed_b', password: userPwd, displayName: 'Ahmed Bensalem', role: UserRole.USER, email: 'ahmed@example.com', phone: '+21655987654' }
  });
  await prisma.user.create({
    data: { username: 'fatma_t', password: userPwd, displayName: 'Fatma Trabelsi', role: UserRole.USER, email: 'fatma@example.com' }
  });

  // ─── TRIPS ──────────────────────────────────────
  console.log('🚗 Seeding trips...');
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const dep = (h: number, m = 0) => { const d = new Date(tomorrow); d.setHours(h, m, 0, 0); return d; };
  const arr = (h: number, m = 0) => { const d = new Date(tomorrow); d.setHours(h, m, 0, 0); return d; };

  // Louage trips
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op1.id, operatorName: op1.displayName,
    fromCity: 'Tunis', toCity: 'Sfax', departureTime: dep(7, 30), arrivalTime: arr(11, 0),
    louageTrip: { create: { stationId: moncefBey.id, price: 15, totalSeats: 8, availableSeats: 3, isFull: false, contactInfo: '+21698123456' } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op2.id, operatorName: op2.displayName,
    fromCity: 'Tunis', toCity: 'Sousse', departureTime: dep(8, 0), arrivalTime: arr(10, 0),
    louageTrip: { create: { stationId: moncefBey.id, price: 8, totalSeats: 8, availableSeats: 0, isFull: true, contactInfo: '+21622456789' } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op1.id, operatorName: op1.displayName,
    fromCity: 'Tunis', toCity: 'Bizerte', departureTime: dep(7, 45), arrivalTime: arr(9, 15),
    louageTrip: { create: { stationId: babSaadoun.id, price: 5, totalSeats: 8, availableSeats: 4, isFull: false, contactInfo: '+21650111222' } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op2.id, operatorName: op2.displayName,
    fromCity: 'Sousse', toCity: 'Nabeul', departureTime: dep(10, 15), arrivalTime: arr(12, 0),
    louageTrip: { create: { stationId: sousse.id, price: 6, totalSeats: 8, availableSeats: 2, isFull: false, contactInfo: '+21655321654' } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op1.id, operatorName: op1.displayName,
    fromCity: 'Sfax', toCity: 'Gabès', departureTime: dep(9, 0), arrivalTime: arr(11, 0),
    louageTrip: { create: { stationId: sfax.id, price: 9, totalSeats: 8, availableSeats: 5, isFull: false, contactInfo: '+21674555888' } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.LOUAGE, operatorId: op2.id, operatorName: op2.displayName,
    fromCity: 'Tunis', toCity: 'Kairouan', departureTime: dep(8, 15), arrivalTime: arr(10, 15),
    louageTrip: { create: { stationId: moncefBey.id, price: 7, totalSeats: 8, availableSeats: 6, isFull: false, contactInfo: '+21677345678' } }
  }});

  // Bus trips
  await prisma.trip.create({ data: {
    type: TransportType.BUS, operatorId: op3.id, operatorName: op3.displayName,
    fromCity: 'Tunis', toCity: 'Sfax', departureTime: dep(9, 0), arrivalTime: arr(13, 0),
    busTrip: { create: { departureStationId: babSaadoun.id, arrivalStationId: sfax.id, price: 12, totalSeats: 50, availableSeats: 20 } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.BUS, operatorId: op3.id, operatorName: op3.displayName,
    fromCity: 'Tunis', toCity: 'Bizerte', departureTime: dep(11, 30), arrivalTime: arr(13, 30),
    busTrip: { create: { departureStationId: babSaadoun.id, arrivalStationId: bizerte.id, price: 5, totalSeats: 50, availableSeats: 35 } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.BUS, operatorId: op3.id, operatorName: op3.displayName,
    fromCity: 'Sousse', toCity: 'Sfax', departureTime: dep(8, 30), arrivalTime: arr(10, 30),
    busTrip: { create: { departureStationId: sousse.id, arrivalStationId: sfax.id, price: 7, totalSeats: 50, availableSeats: 18 } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.BUS, operatorId: op3.id, operatorName: op3.displayName,
    fromCity: 'Tunis', toCity: 'Gafsa', departureTime: dep(10, 0), arrivalTime: arr(14, 30),
    busTrip: { create: { departureStationId: babSaadoun.id, arrivalStationId: gafsa.id, price: 18, totalSeats: 50, availableSeats: 28 } }
  }});

  // Transporter trips
  await prisma.trip.create({ data: {
    type: TransportType.TRANSPORTER, operatorId: op1.id, operatorName: 'Maghreb Transport',
    fromCity: 'Tunis', toCity: 'Libya', departureTime: dep(6, 0), arrivalTime: arr(20, 0),
    transporterTrip: { create: { contactInfo: '+21650987654', vehicleType: 'Box truck', availableSpace: '8 m³', eta: '~14h', route: ['Tunis', 'Sfax', 'Medenine', 'Ben Gardane', 'Libya'] } }
  }});
  await prisma.trip.create({ data: {
    type: TransportType.TRANSPORTER, operatorId: op2.id, operatorName: 'Euro Logistics',
    fromCity: 'Tunis', toCity: 'France', departureTime: dep(5, 0), arrivalTime: arr(5, 0),
    transporterTrip: { create: { contactInfo: '+21671234567', vehicleType: 'Semi-trailer', availableSpace: '12 m³', eta: '~3 days', route: ['Tunis', 'Bizerte', 'Ferry to Italy', 'France'] } }
  }});

  // ─── WELCOME NOTIFICATION ────────────────────────
  await prisma.notification.create({
    data: { userId: admin.id, type: 'SYSTEM', title: 'Welcome to Transit TN Admin', message: 'Your admin dashboard is ready. Add operators and trips to get started.', read: false }
  });

  console.log('✅ Seeding complete!');
  console.log('\n🔑 Demo credentials:');
  console.log('  Admin:    username=admin        password=Admin@123!');
  console.log('  Operator: username=sfax_express  password=Operator@123!');
  console.log('  User:     username=ahmed_b       password=User@123!');
}

main()
  .catch(e => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
