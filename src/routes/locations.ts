import { Router, Request, Response } from 'express';

export const router = Router();

// Static list of Tunisian governorates and delegations
const LOCATIONS = [
  { id: 'tunis', name: 'Tunis', delegations: ['Tunis', 'Carthage', 'La Marsa', 'Sidi Bou Said', 'Le Bardo', 'Ariana', 'Menzah'] },
  { id: 'ariana', name: 'Ariana', delegations: ['Ariana', 'Ettadhamen', 'Mnihla', 'Kalaat el-Andalous'] },
  { id: 'ben-arous', name: 'Ben Arous', delegations: ['Ben Arous', 'Hammam Lif', 'Ezzahra', 'Mohamedia', 'Mégrine'] },
  { id: 'manouba', name: 'Manouba', delegations: ['Manouba', 'Den Den', 'Oued Ellil', 'El Battane'] },
  { id: 'nabeul', name: 'Nabeul', delegations: ['Nabeul', 'Hammamet', 'Kelibia', 'Korba', 'Soliman', 'Grombalia'] },
  { id: 'zaghouan', name: 'Zaghouan', delegations: ['Zaghouan', 'Zriba', 'El Fahs', 'Bir Mcherga'] },
  { id: 'bizerte', name: 'Bizerte', delegations: ['Bizerte', 'Mateur', 'Menzel Bourguiba', 'Sejnane', 'Ras Jebel'] },
  { id: 'beja', name: 'Béja', delegations: ['Béja', 'Testour', 'Thibar', 'Nefza', 'Amdoun'] },
  { id: 'jendouba', name: 'Jendouba', delegations: ['Jendouba', 'Tabarka', 'Ain Draham', 'Fernana', 'Bou Salem'] },
  { id: 'kef', name: 'Kef', delegations: ['Le Kef', 'Tajerouine', 'Sers', 'Sakiet Sidi Youssef'] },
  { id: 'siliana', name: 'Siliana', delegations: ['Siliana', 'Bou Arada', 'Makthar', 'Rouhia', 'Gaafour'] },
  { id: 'kairouan', name: 'Kairouan', delegations: ['Kairouan', 'Oueslatia', 'Haffouz', 'Hajeb El Ayoun', 'Sbikha'] },
  { id: 'kasserine', name: 'Kasserine', delegations: ['Kasserine', 'Sbeitla', 'Feriana', 'Thala', 'Foussana'] },
  { id: 'sidi-bouzid', name: 'Sidi Bouzid', delegations: ['Sidi Bouzid', 'Regueb', 'Meknassy', 'Ouled Haffouz', 'Jelma'] },
  { id: 'sousse', name: 'Sousse', delegations: ['Sousse', 'Hammam Sousse', 'Port el Kantaoui', 'Msaken', 'Kalaa Kebira', 'Enfidha'] },
  { id: 'monastir', name: 'Monastir', delegations: ['Monastir', 'Skanes', 'Ksar Hellal', 'Jemmal', 'Moknine', 'Mahdia'] },
  { id: 'mahdia', name: 'Mahdia', delegations: ['Mahdia', 'El Jem', 'Chebba', 'Ksour Essef', 'Bou Merdes'] },
  { id: 'sfax', name: 'Sfax', delegations: ['Sfax', 'Sakiet Ezzit', 'Sakiet Eddaier', 'Thyna', 'El Hencha', 'Agareb'] },
  { id: 'gabes', name: 'Gabès', delegations: ['Gabès', 'Mareth', 'Matmata', 'El Hamma', 'Ghannouch'] },
  { id: 'medenine', name: 'Medenine', delegations: ['Medenine', 'Zarzis', 'Houmt Souk', 'Ben Gardane', 'Jerba'] },
  { id: 'tataouine', name: 'Tataouine', delegations: ['Tataouine', 'Ghomrassen', 'Remada', 'Bir Lahmar', 'Dehiba'] },
  { id: 'gafsa', name: 'Gafsa', delegations: ['Gafsa', 'Metlaoui', 'El Guettar', 'Redeyef', 'Moularès'] },
  { id: 'tozeur', name: 'Tozeur', delegations: ['Tozeur', 'Nefta', 'Degache', 'Hezoua', 'Tameghza'] },
  { id: 'kebili', name: 'Kébili', delegations: ['Kébili', 'Douz', 'Souk Lahad', 'Faouar', 'El Golaa'] },
];

// ─── GET /api/locations ──────────────────────────
router.get('/', (_req: Request, res: Response) => {
  return res.json(LOCATIONS);
});

// ─── GET /api/locations/:id ──────────────────────
router.get('/:id', (req: Request, res: Response) => {
  const loc = LOCATIONS.find(l => l.id === req.params.id);
  if (!loc) return res.status(404).json({ message: 'Location not found' });
  return res.json(loc);
});
