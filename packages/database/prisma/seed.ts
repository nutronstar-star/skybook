import argon2 from 'argon2';
import { prisma, encryptPii, blindIndexPii } from '../src/index.js';

async function main() {
  console.log('Seeding SkyBook PostgreSQL 16 database...');

  // 1. Default Admin Account (NFR-S-01: Argon2id 64MB, 3 iter, 4 threads)
  const adminEmail = 'admin@skybook.in';
  const adminPasswordHash = await argon2.hash('SkyBook@Admin2026!#', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  const existingAdmin = await prisma.adminProfile.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        role: 'ADMIN',
        adminProfile: {
          create: {
            email: adminEmail,
            fullName: 'SkyBook Operations Admin',
            passwordHash: adminPasswordHash
          }
        }
      }
    });
    console.log('  [+] Created default Admin: admin@skybook.in / SkyBook@Admin2026!#');
  }

  // 2. Sample Passenger Account (+919876543210)
  const demoPhone = '+919876543210';
  const demoPhoneHash = blindIndexPii(demoPhone);
  const existingPax = await prisma.passengerProfile.findUnique({ where: { phoneHash: demoPhoneHash } });
  if (!existingPax) {
    await prisma.user.create({
      data: {
        role: 'PASSENGER',
        passengerProfile: {
          create: {
            phoneEncrypted: encryptPii(demoPhone),
            phoneHash: demoPhoneHash,
            phoneLast4: '3210',
            emailEncrypted: encryptPii('aarav.sharma@example.com'),
            emailHash: blindIndexPii('aarav.sharma@example.com'),
            emailDomain: 'example.com',
            fullNameEncrypted: encryptPii('Aarav Sharma')
          }
        }
      }
    });
    console.log('  [+] Created sample Passenger: +919876543210');
  }

  // 3. Six Domestic Cities & Airports (Ch 6 §6.10)
  const hubs = [
    { city: 'New Delhi', state: 'Delhi', iata: 'DEL', airport: 'Indira Gandhi International Airport' },
    { city: 'Mumbai', state: 'Maharashtra', iata: 'BOM', airport: 'Chhatrapati Shivaji Maharaj International Airport' },
    { city: 'Bengaluru', state: 'Karnataka', iata: 'BLR', airport: 'Kempegowda International Airport' },
    { city: 'Hyderabad', state: 'Telangana', iata: 'HYD', airport: 'Rajiv Gandhi International Airport' },
    { city: 'Kolkata', state: 'West Bengal', iata: 'CCU', airport: 'Netaji Subhas Chandra Bose International Airport' },
    { city: 'Chennai', state: 'Tamil Nadu', iata: 'MAA', airport: 'Chennai International Airport' }
  ];

  const airportMap = new Map<string, string>();
  for (const h of hubs) {
    const city = await prisma.city.upsert({
      where: { name: h.city },
      update: {},
      create: { name: h.city, state: h.state, country: 'India' }
    });
    const airport = await prisma.airport.upsert({
      where: { iataCode: h.iata },
      update: {},
      create: { cityId: city.id, iataCode: h.iata, name: h.airport }
    });
    airportMap.set(h.iata, airport.id);
  }
  console.log('  [+] Seeded 6 domestic cities & airports (DEL, BOM, BLR, HYD, CCU, MAA)');

  // 4. Aircraft Types & Seat Layouts (Airbus A320neo: 30 rows x 6 cols = 180 seats)
  let a320 = await prisma.aircraftType.findUnique({ where: { code: 'A320NEO' } });
  if (!a320) {
    a320 = await prisma.aircraftType.create({
      data: {
        code: 'A320NEO',
        name: 'Airbus A320neo',
        totalSeats: 180,
        businessSeats: 18,
        economySeats: 162
      }
    });

    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    const layoutRows: Array<{
      aircraftTypeId: string;
      seatNumber: string;
      rowNumber: number;
      columnLetter: string;
      cabinClass: 'BUSINESS' | 'ECONOMY';
      isExitRow: boolean;
      isWindow: boolean;
    }> = [];

    for (let row = 1; row <= 30; row++) {
      const cabinClass = row <= 3 ? 'BUSINESS' : 'ECONOMY';
      const isExitRow = row === 12 || row === 13;
      for (const col of cols) {
        layoutRows.push({
          aircraftTypeId: a320.id,
          seatNumber: `${row}${col}`,
          rowNumber: row,
          columnLetter: col,
          cabinClass,
          isExitRow,
          isWindow: col === 'A' || col === 'F'
        });
      }
    }
    await prisma.seatLayout.createMany({ data: layoutRows });
    console.log('  [+] Seeded Airbus A320neo with 180-seat layout');
  }

  // 5. Seed 24 Published Flights across next 7 days
  const existingFlightCount = await prisma.flight.count();
  if (existingFlightCount === 0 && a320) {
    const routes = [
      { num: 'SB-101', from: 'DEL', to: 'BOM', dur: 130, eco: 485000, biz: 1450000, hour: 7 },
      { num: 'SB-102', from: 'BOM', to: 'DEL', dur: 135, eco: 495000, biz: 1480000, hour: 10 },
      { num: 'SB-203', from: 'DEL', to: 'BLR', dur: 165, eco: 560000, biz: 1690000, hour: 9 },
      { num: 'SB-204', from: 'BLR', to: 'BOM', dur: 105, eco: 390000, biz: 1180000, hour: 14 },
      { num: 'SB-305', from: 'HYD', to: 'DEL', dur: 140, eco: 470000, biz: 1420000, hour: 11 },
      { num: 'SB-406', from: 'CCU', to: 'MAA', dur: 145, eco: 510000, biz: 1520000, hour: 16 }
    ];

    const layouts = await prisma.seatLayout.findMany({ where: { aircraftTypeId: a320.id } });
    const baseDate = new Date();
    baseDate.setUTCHours(0, 0, 0, 0);

    let createdFlights = 0;
    for (let dayOffset = 1; dayOffset <= 4; dayOffset++) {
      for (const r of routes) {
        const dep = new Date(baseDate.getTime() + dayOffset * 86_400_000 + r.hour * 3_600_000);
        const arr = new Date(dep.getTime() + r.dur * 60_000);
        const flightNumber = `${r.num}-${dayOffset}`;

        const flight = await prisma.flight.create({
          data: {
            flightNumber,
            airlineName: 'SkyBook Air',
            originAirportId: airportMap.get(r.from)!,
            destinationAirportId: airportMap.get(r.to)!,
            aircraftTypeId: a320.id,
            departureTime: dep,
            arrivalTime: arr,
            durationMinutes: r.dur,
            economyBasePaise: r.eco,
            businessBasePaise: r.biz,
            status: 'PUBLISHED'
          }
        });

        await prisma.flightSeat.createMany({
          data: layouts.map((l) => ({
            flightId: flight.id,
            seatNumber: l.seatNumber,
            rowNumber: l.rowNumber,
            columnLetter: l.columnLetter,
            cabinClass: l.cabinClass,
            farePaise: l.cabinClass === 'BUSINESS' ? r.biz : r.eco,
            status: 'AVAILABLE',
            isExitRow: l.isExitRow,
            isWindow: l.isWindow
          }))
        });
        createdFlights++;
      }
    }
    console.log(`  [+] Seeded ${createdFlights} PUBLISHED flights with 180 seats each`);
  }

  // 6. Initial Audit Log entry
  await prisma.auditLog.create({
    data: {
      actorRole: 'SYSTEM',
      entityType: 'DATABASE',
      entityId: 'SEED_V1',
      action: 'INITIAL_SEED_COMPLETED',
      reason: 'Phase 1 baseline catalog and accounts seeded'
    }
  });
  console.log('Seed completed successfully.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });