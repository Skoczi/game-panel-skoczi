export interface ProjectZomboidModId {
  id: string;
  enabled: boolean;
}

export interface ProjectZomboidMod {
  workshopId: string;
  modIds: ProjectZomboidModId[];
  enabled: boolean;
  title?: string;
  previewUrl?: string;
  description?: string;
  tags?: string[];
}

export interface ProjectZomboidWorkshopPreview {
  workshopId: string;
  title?: string;
  previewUrl?: string;
  description?: string;
  tags?: string[];
}
