import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

@ValidatorConstraint({ name: 'isYearNotFuture', async: false })
export class IsYearNotFutureConstraint implements ValidatorConstraintInterface {
  validate(year: any) {
    if (typeof year !== 'number') return false;
    const currentYear = new Date().getFullYear();
    return year <= currentYear + 1; // Allow up to next year for planned developments
  }

  defaultMessage(args: ValidationArguments) {
    return `Year ${args.value} cannot be in the distant future`;
  }
}

export function IsYearNotFuture(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsYearNotFutureConstraint,
    });
  };
}
