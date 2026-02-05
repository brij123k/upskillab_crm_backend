import { IsArray, IsString } from "class-validator";

export class MergeLeadsDTO {
    @IsString()
  masterLeadId: string;

  @IsArray()
  duplicateLeadIds: string[];
}
