import {
  IsString,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsOptional,
  ArrayNotEmpty,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyFeaturesDto } from './property-features.dto';

export class PropertyValuationItemDto {
  @ApiProperty({ description: 'ID of the property to value', example: 'prop-123' })
  @IsString({ message: 'Property ID must be a string' })
  @IsNotEmpty({ message: 'Property ID is required' })
  propertyId: string;

  @ApiPropertyOptional({ description: 'Property features for valuation', type: PropertyFeaturesDto })
  @IsOptional()
  @ValidateNested({ message: 'Features must be a valid features object' })
  @Type(() => PropertyFeaturesDto)
  features?: PropertyFeaturesDto;
}

export class BatchValuationRequestDto {
  @ApiProperty({ description: 'Array of property valuation items', type: [PropertyValuationItemDto] })
  @IsArray({ message: 'Properties must be an array' })
  @ArrayNotEmpty({ message: 'Array of properties cannot be empty' })
  @ArrayMaxSize(50, { message: 'Maximum 50 properties can be valuated in a single batch' })
  @ValidateNested({ each: true, message: 'Each property item must be valid' })
  @Type(() => PropertyValuationItemDto)
  properties: PropertyValuationItemDto[];
}
