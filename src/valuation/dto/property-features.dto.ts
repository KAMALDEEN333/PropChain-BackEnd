import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsNotEmpty,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsYearNotFuture } from '../../common/validators/year-not-future.validator';
import { IsXssSafe } from '../../common/validators/xss.validator';
import { IsNotSqlInjection } from '../../common/validators/sql-injection.validator';
import { PropertyType } from '../../properties/dto/create-property.dto';

export class PropertyFeaturesDto {
  @ApiPropertyOptional({ description: 'Internal property ID', example: 'prop-123' })
  @IsOptional()
  @IsString({ message: 'ID must be a string' })
  id?: string;

  @ApiProperty({ description: 'Property location/address', example: '123 Main St, New York, NY' })
  @IsString({ message: 'Location must be a string' })
  @IsNotEmpty({ message: 'Location is required' })
  @MaxLength(500, { message: 'Location is too long' })
  @IsXssSafe({ message: 'Location contains potentially malicious content' })
  @IsNotSqlInjection({ message: 'Location contains potential SQL injection' })
  location: string;

  @ApiPropertyOptional({ description: 'Number of bedrooms', example: 3, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber({}, { message: 'Bedrooms must be a number' })
  @Min(0, { message: 'Bedrooms cannot be negative' })
  @Max(50, { message: 'Bedrooms cannot exceed 50' })
  bedrooms?: number;

  @ApiPropertyOptional({ description: 'Number of bathrooms', example: 2.5, minimum: 0, maximum: 50 })
  @IsOptional()
  @IsNumber({}, { message: 'Bathrooms must be a number' })
  @Min(0, { message: 'Bathrooms cannot be negative' })
  @Max(50, { message: 'Bathrooms cannot exceed 50' })
  bathrooms?: number;

  @ApiPropertyOptional({ description: 'Square footage', example: 1500, minimum: 10, maximum: 1000000 })
  @IsOptional()
  @IsNumber({}, { message: 'Square footage must be a number' })
  @Min(10, { message: 'Square footage must be at least 10' })
  @Max(1000000, { message: 'Square footage cannot exceed 1,000,000' })
  squareFootage?: number;

  @ApiPropertyOptional({ description: 'Year built', example: 2010, minimum: 1600 })
  @IsOptional()
  @IsNumber({}, { message: 'Year built must be a number' })
  @Min(1600, { message: 'Year built must be after 1600' })
  @IsYearNotFuture({ message: 'Year built cannot be in the distant future' })
  yearBuilt?: number;

  @ApiPropertyOptional({ description: 'Type of property', enum: PropertyType, example: PropertyType.RESIDENTIAL })
  @IsOptional()
  @IsEnum(PropertyType, { message: 'Invalid property type' })
  propertyType?: PropertyType;

  @ApiPropertyOptional({ description: 'Lot size in acres', example: 0.25, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber({}, { message: 'Lot size must be a number' })
  @Min(0, { message: 'Lot size cannot be negative' })
  @Max(1000, { message: 'Lot size cannot exceed 1000 acres' })
  lotSize?: number;

  // Allow additional properties to maintain compatibility with PropertyFeatures interface
  [key: string]: string | number | boolean | undefined | any;
}
