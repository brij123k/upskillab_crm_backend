import { IsArray, IsNumber, IsString } from "class-validator";

export class MergeLeadsDTO {
    @IsNumber()
  masterLeadId: number;

  @IsArray()
  duplicateLeadIds: number[];
}
